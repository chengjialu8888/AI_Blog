#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const DEFAULT_API_BASE = 'https://api.weixin.qq.com';
const DEFAULT_INLINE_LIMIT = 950_000;
const DEFAULT_THUMB_LIMIT = 60_000;

let fatalHandled = false;
function handleFatal(error) {
  if (fatalHandled) return;
  fatalHandled = true;
  console.error(`Error: ${error?.message || error}`);
  process.exit(1);
}
process.on('uncaughtException', handleFatal);
process.on('unhandledRejection', handleFatal);

function printHelp() {
  console.log(`Usage:
  node scripts/wechat-publish.mjs --input <article.html> [options]

Safe by default:
  Without --execute, the command performs a dry-run and never contacts WeChat.

Options:
  --input <path>            Source standalone HTML file (required)
  --output <path>           Output HTML with WeChat CDN image URLs
  --execute                 Upload images and write the ready HTML
  --create-draft            Also create a draft in the official account
  --thumb-file <path>       Cover image to upload as permanent thumb material
  --thumb-media-id <id>     Reuse an existing WeChat thumb media_id
  --title <text>            Draft title override; defaults to <title>
  --author <text>           Draft author; defaults to WECHAT_AUTHOR
  --digest <text>           Draft digest; defaults to meta description
  --source-url <url>        Draft content source URL
  --cache <path>            Upload cache path; defaults beside the input HTML
  --refresh                 Ignore cached image URLs and upload again
  --no-optimize             Fail instead of optimizing oversized images
  --keep-dot-labels         Keep expanded HTML dot-matrix labels in draft content
  --help                    Show this help

Credentials, read only when --execute is used:
  WECHAT_ACCESS_TOKEN       Optional existing access token
  WECHAT_APP_ID             Official account AppID
  WECHAT_APP_SECRET         Official account AppSecret
  WECHAT_AUTHOR             Optional default author
`);
}

function fail(message) {
  throw new Error(message);
}

function normalizePath(inputPath) {
  return isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
}

function defaultOutputPath(inputPath) {
  const extension = extname(inputPath);
  return inputPath.slice(0, -extension.length) + '-wechat-ready' + extension;
}

function extractAttribute(html, pattern) {
  return html.match(pattern)?.[1]?.trim() || '';
}

function extractTitle(html) {
  return decodeEntities(extractAttribute(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
}

function extractDescription(html) {
  return decodeEntities(extractAttribute(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i));
}

function extractOgImage(html) {
  return extractAttribute(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["'][^>]*>/i);
}

function extractArticleInnerHtml(html) {
  return html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]?.trim() || '';
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function uniqueLocalImages(html, htmlPath) {
  const seen = new Set();
  const images = [];
  const imageRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imageRegex)) {
    const src = match[1];
    if (/^(?:https?:|data:|blob:)/i.test(src)) continue;
    if (src.startsWith('//')) continue;
    const filePath = src.startsWith('file:')
      ? decodeURIComponent(new URL(src).pathname)
      : resolve(dirname(htmlPath), decodeURIComponent(src));
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    images.push({ src, filePath });
  }
  return images;
}

function replaceImageSources(html, replacements) {
  let output = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (full, before, src, after) => {
    return replacements.has(src) ? `${before}${replacements.get(src)}${after}` : full;
  });
  output = output.replace(/(<meta\b[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["'])([^"']+)(["'][^>]*>)/gi, (full, before, src, after) => {
    return replacements.has(src) ? `${before}${replacements.get(src)}${after}` : full;
  });
  return output;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function loadCache(cachePath) {
  if (!existsSync(cachePath)) return { version: 1, inline: {}, thumb: {} };
  try {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    return {
      version: 1,
      inline: cache.inline || {},
      thumb: cache.thumb || {}
    };
  } catch (error) {
    fail(`Cannot parse cache file ${cachePath}: ${error.message}`);
  }
}

function saveCache(cachePath, cache) {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
}

function mimeType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  fail(`Unsupported image type for ${filePath}; WeChat inline images must be JPG or PNG`);
}

function runSips(inputPath, outputPath, maxDimension, quality) {
  const result = spawnSync('/usr/bin/sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(quality),
    '-Z', String(maxDimension),
    inputPath,
    '--out', outputPath
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Image optimization failed for ${inputPath}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

function prepareImage(inputPath, options) {
  const { maxBytes, tempDirectory, optimize, thumb = false } = options;
  const size = statSync(inputPath).size;
  if (size <= maxBytes && !thumb) return { uploadPath: inputPath, optimized: false, originalBytes: size, uploadBytes: size };
  if (!optimize) fail(`${inputPath} is ${size} bytes, above the ${maxBytes}-byte limit; remove --no-optimize or optimize it manually`);
  if (!existsSync('/usr/bin/sips')) fail('Automatic optimization requires /usr/bin/sips on macOS');

  const outputPath = join(tempDirectory, `${sha256(inputPath).slice(0, 16)}-${thumb ? 'thumb' : 'inline'}.jpg`);
  const attempts = thumb
    ? [[900, 72], [800, 62], [700, 52], [600, 44], [500, 38]]
    : [[2048, 84], [1800, 80], [1600, 76], [1400, 72], [1200, 68]];

  for (const [dimension, quality] of attempts) {
    runSips(inputPath, outputPath, dimension, quality);
    const uploadBytes = statSync(outputPath).size;
    if (uploadBytes <= maxBytes) {
      return { uploadPath: outputPath, optimized: true, originalBytes: size, uploadBytes };
    }
  }
  fail(`Could not optimize ${inputPath} below ${maxBytes} bytes`);
}

async function readJsonResponse(response, action) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`${action} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || (data.errcode && data.errcode !== 0)) {
    fail(`${action} failed: ${data.errcode ?? response.status} ${data.errmsg || 'unknown error'}`);
  }
  return data;
}

async function getAccessToken(apiBase) {
  if (process.env.WECHAT_ACCESS_TOKEN) return process.env.WECHAT_ACCESS_TOKEN;
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) {
    fail('Set WECHAT_ACCESS_TOKEN, or set both WECHAT_APP_ID and WECHAT_APP_SECRET in the local environment');
  }
  const url = new URL('/cgi-bin/token', apiBase);
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  const response = await fetch(url);
  const data = await readJsonResponse(response, 'Access-token request');
  if (!data.access_token) fail('Access-token response did not include access_token');
  return data.access_token;
}

async function uploadInlineImage(apiBase, accessToken, filePath) {
  const url = new URL('/cgi-bin/media/uploadimg', apiBase);
  url.searchParams.set('access_token', accessToken);
  const form = new FormData();
  form.set('media', new Blob([readFileSync(filePath)], { type: mimeType(filePath) }), basename(filePath));
  const response = await fetch(url, { method: 'POST', body: form });
  const data = await readJsonResponse(response, `Inline image upload for ${basename(filePath)}`);
  if (!data.url) fail(`Inline image upload for ${basename(filePath)} did not return a URL`);
  return data.url;
}

async function uploadThumb(apiBase, accessToken, filePath) {
  const url = new URL('/cgi-bin/material/add_material', apiBase);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'thumb');
  const form = new FormData();
  form.set('media', new Blob([readFileSync(filePath)], { type: mimeType(filePath) }), basename(filePath));
  const response = await fetch(url, { method: 'POST', body: form });
  const data = await readJsonResponse(response, `Cover upload for ${basename(filePath)}`);
  if (!data.media_id) fail(`Cover upload for ${basename(filePath)} did not return media_id`);
  return data.media_id;
}

async function createDraft(apiBase, accessToken, article) {
  const url = new URL('/cgi-bin/draft/add', apiBase);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ articles: [article] })
  });
  const data = await readJsonResponse(response, 'Draft creation');
  if (!data.media_id) fail('Draft creation did not return media_id');
  return data.media_id;
}

function compactDotMatrixLabels(html) {
  let cursor = 0;
  let output = '';
  while (cursor < html.length) {
    const start = html.indexOf('<span aria-label="', cursor);
    if (start === -1) {
      output += html.slice(cursor);
      break;
    }
    output += html.slice(cursor, start);
    const openingEnd = html.indexOf('>', start);
    if (openingEnd === -1) {
      output += html.slice(start);
      break;
    }
    const opening = html.slice(start, openingEnd + 1);
    const label = opening.match(/aria-label="([^"]*)"/)?.[1] || '';
    let depth = 1;
    let scan = openingEnd + 1;
    while (depth > 0 && scan < html.length) {
      const nextOpen = html.indexOf('<span', scan);
      const nextClose = html.indexOf('</span>', scan);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        scan = html.indexOf('>', nextOpen) + 1;
      } else {
        depth -= 1;
        scan = nextClose + '</span>'.length;
      }
    }
    output += `<span style="font-family:'SFMono-Regular','SF Mono',monospace;font-size:12px;font-weight:700;color:#111111;">${label}</span>`;
    cursor = scan;
  }
  return output;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    execute: { type: 'boolean', default: false },
    'create-draft': { type: 'boolean', default: false },
    'thumb-file': { type: 'string' },
    'thumb-media-id': { type: 'string' },
    title: { type: 'string' },
    author: { type: 'string' },
    digest: { type: 'string' },
    'source-url': { type: 'string' },
    cache: { type: 'string' },
    refresh: { type: 'boolean', default: false },
    'no-optimize': { type: 'boolean', default: false },
    'keep-dot-labels': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  },
  allowPositionals: false
});

if (values.help) {
  printHelp();
  process.exit(0);
}
if (!values.input) fail('--input is required');
if (values['create-draft'] && !values.execute) fail('--create-draft requires --execute');

const inputPath = normalizePath(values.input);
if (!existsSync(inputPath)) fail(`Input HTML does not exist: ${inputPath}`);
const outputPath = normalizePath(values.output || defaultOutputPath(inputPath));
const cachePath = normalizePath(values.cache || join(dirname(inputPath), '.wechat-media-cache.json'));
const html = readFileSync(inputPath, 'utf8');
const localImages = uniqueLocalImages(html, inputPath);
const title = values.title || extractTitle(html);
const digest = values.digest || extractDescription(html);
const articleInnerHtml = extractArticleInnerHtml(html);
if (!title) fail('Could not determine article title; add <title> or pass --title');
if (values['create-draft'] && !articleInnerHtml) fail('Could not find an <article> element for draft content');

const oversized = localImages.filter(({ filePath }) => {
  if (!existsSync(filePath)) fail(`Local image does not exist: ${filePath}`);
  mimeType(filePath);
  return statSync(filePath).size > DEFAULT_INLINE_LIMIT;
});

console.log(values.execute ? 'Mode: execute' : 'Mode: dry-run');
console.log(`Input: ${relative(process.cwd(), inputPath)}`);
console.log(`Output: ${relative(process.cwd(), outputPath)}`);
console.log(`Title: ${title}`);
console.log(`Local images: ${localImages.length}`);
console.log(`Images requiring optimization: ${oversized.length}`);
console.log(`Article fragment: ${Buffer.byteLength(articleInnerHtml)} bytes`);

if (!values.execute) {
  for (const { filePath } of oversized) {
    console.log(`  optimize: ${relative(process.cwd(), filePath)} (${statSync(filePath).size} bytes)`);
  }
  console.log('Dry-run complete. Add --execute after configuring local WeChat credentials.');
  process.exit(0);
}

const apiBase = process.env.WECHAT_API_BASE || DEFAULT_API_BASE;
const accessToken = await getAccessToken(apiBase);
const cache = loadCache(cachePath);
const replacements = new Map();
const tempDirectory = mkdtempSync(join(tmpdir(), 'wechat-upload-'));

try {
  for (let index = 0; index < localImages.length; index += 1) {
    const image = localImages[index];
    const hash = sha256(image.filePath);
    const cached = !values.refresh && cache.inline[hash]?.url;
    if (cached) {
      replacements.set(image.src, cached);
      console.log(`[${index + 1}/${localImages.length}] cached ${basename(image.filePath)}`);
      continue;
    }
    const prepared = prepareImage(image.filePath, {
      maxBytes: DEFAULT_INLINE_LIMIT,
      tempDirectory,
      optimize: !values['no-optimize']
    });
    const uploadedUrl = await uploadInlineImage(apiBase, accessToken, prepared.uploadPath);
    replacements.set(image.src, uploadedUrl);
    cache.inline[hash] = {
      url: uploadedUrl,
      source: relative(process.cwd(), image.filePath),
      uploadedAt: new Date().toISOString()
    };
    saveCache(cachePath, cache);
    console.log(`[${index + 1}/${localImages.length}] uploaded ${basename(image.filePath)}${prepared.optimized ? ` (${prepared.originalBytes} -> ${prepared.uploadBytes} bytes)` : ''}`);
    await sleep(180);
  }

  const readyHtml = replaceImageSources(html, replacements);
  writeFileSync(outputPath, readyHtml);
  console.log(`Ready HTML written: ${relative(process.cwd(), outputPath)}`);

  if (values['create-draft']) {
    let thumbMediaId = values['thumb-media-id'];
    if (!thumbMediaId) {
      const heroSrc = values['thumb-file'] || extractOgImage(html);
      if (!heroSrc) fail('Draft creation needs --thumb-media-id, --thumb-file, or an og:image meta tag');
      const heroPath = normalizePath(values['thumb-file'] || resolve(dirname(inputPath), heroSrc));
      if (!existsSync(heroPath)) fail(`Cover image does not exist: ${heroPath}`);
      const hash = sha256(heroPath);
      thumbMediaId = !values.refresh ? cache.thumb[hash]?.mediaId : undefined;
      if (!thumbMediaId) {
        const preparedThumb = prepareImage(heroPath, {
          maxBytes: DEFAULT_THUMB_LIMIT,
          tempDirectory,
          optimize: !values['no-optimize'],
          thumb: true
        });
        thumbMediaId = await uploadThumb(apiBase, accessToken, preparedThumb.uploadPath);
        cache.thumb[hash] = {
          mediaId: thumbMediaId,
          source: relative(process.cwd(), heroPath),
          uploadedAt: new Date().toISOString()
        };
        saveCache(cachePath, cache);
        console.log(`Cover uploaded: ${basename(heroPath)} (${preparedThumb.originalBytes} -> ${preparedThumb.uploadBytes} bytes)`);
      } else {
        console.log(`Cover reused from cache: ${basename(heroPath)}`);
      }
    }

    let draftContent = extractArticleInnerHtml(readyHtml);
    if (!values['keep-dot-labels']) draftContent = compactDotMatrixLabels(draftContent);
    const draftMediaId = await createDraft(apiBase, accessToken, {
      title,
      author: values.author || process.env.WECHAT_AUTHOR || '',
      digest,
      content: draftContent,
      content_source_url: values['source-url'] || '',
      thumb_media_id: thumbMediaId,
      show_cover_pic: 0,
      need_open_comment: 0,
      only_fans_can_comment: 0
    });
    console.log(`Draft created successfully. media_id: ${draftMediaId}`);
  }
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
