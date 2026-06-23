#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { extractDailyItems, extractSummary, extractWeeklyTrends } from './lib/markdown.mjs';
import { escapeHtml, inlineMarkdown, stripMarkdown } from './lib/text.mjs';

const args = parseArgs(process.argv.slice(2));
const templatePath = args.template || 'templates/weekly-wechat-template.json';
const template = JSON.parse(readFileSync(templatePath, 'utf8'));

const outMd = args['out-md'] || 'output/weekly/ai-weekly.md';
const outHtml = args['out-html'] || 'output/weekly/ai-weekly.html';
const outXml = args['out-xml'] || 'output/weekly/ai-weekly.xml';

function moduleHtml(id, vars = {}) {
  const mod = template.modules.find((item) => item.id === id);
  if (!mod) throw new Error(`Missing weekly template module: ${id}`);
  let html = mod.html;
  for (const [key, value] of Object.entries(vars)) html = html.replaceAll(`{{${key}}}`, value);
  return html;
}

function renderMarkdownToWechat(markdown) {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim() || 'AI周报';
  const trends = extractWeeklyTrends(markdown);
  let currentMode = 'intro';
  let body = '';

  const intro = [];
  const conclusion = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    if (line.startsWith('## ')) {
      currentMode = line.includes('结论') ? 'conclusion' : 'body';
      continue;
    }
    if (currentMode === 'intro') intro.push(line);
    else if (currentMode === 'conclusion') conclusion.push(line);
  }

  body += `<h1 style="font-family:${template.global_styles.serif_font};font-size:24px;line-height:1.45;color:${template.global_styles.heading_color};margin:28px 0 16px 0;font-weight:700;">${escapeHtml(title)}</h1>`;
  body += moduleHtml('tldr', { content: escapeHtml(stripMarkdown(intro[0] || '本周 AI 主线继续从模型能力走向真实任务闭环。')) });
  for (const p of intro.slice(0, 3)) body += moduleHtml('paragraph', { content: inlineMarkdown(p) });

  if (trends.length) {
    const toc = trends
      .map((trend, index) => template.modules.find((m) => m.id === 'toc_block').item_template
        .replaceAll('{{part}}', String(index + 1).padStart(2, '0'))
        .replaceAll('{{description}}', escapeHtml(trend.title)))
      .join('\n');
    body += moduleHtml('toc_block', { title: '本周主线', items: toc });
  }

  trends.forEach((trend, index) => {
    body += moduleHtml('divider');
    body += moduleHtml('section_title', { number: String(index + 1), title: escapeHtml(trend.title) });
    for (const p of trend.body.filter((line) => !line.startsWith('**相关信号'))) {
      body += moduleHtml('paragraph', { content: inlineMarkdown(p) });
    }
    if (trend.signals.length) {
      body += moduleHtml('keypoint_block', {
        title: '相关信号：',
        content: escapeHtml(`本节保留 ${trend.signals.length} 条事实线索，供选题会和复盘继续下钻。`),
      });
      for (const signal of trend.signals) {
        body += `<section style="background:#ffffff;border-left:3px solid #d7e0e6;padding:13px 15px;margin:14px 0 8px 0;"><p style="margin:0;font-size:15px;line-height:1.82;color:#3d4852;">${inlineMarkdown(signal.replace(/^-\s+/, ''))}</p></section>`;
      }
    }
  });

  if (conclusion.length) {
    body += moduleHtml('divider');
    body += moduleHtml('section_title', { number: 'END', title: '本周结论' });
    for (const p of conclusion) body += moduleHtml('paragraph', { content: inlineMarkdown(p) });
  }

  body += moduleHtml('author_footer', {
    content: '整理：AI_Blog workflow。数据来自 AI_News_Digest 日报与本周人工/Agent 复核。',
  });

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(title)}</title></head>
<body><main style="max-width:680px;margin:0 auto;background:#fff;">${template.wrapper.opening}${body}${template.wrapper.closing}</main></body>
</html>`;
}

function renderMarkdownToFeishuXml(markdown) {
  const lines = markdown.split(/\r?\n/);
  let xml = '';
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      xml += '</ul>\n';
      listOpen = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith('# ')) {
      closeList();
      xml += `<title>${inlineMarkdown(line.slice(2))}</title>\n`;
    } else if (line.startsWith('## ')) {
      closeList();
      xml += `<h1>${inlineMarkdown(line.slice(3))}</h1>\n`;
    } else if (line.startsWith('### ')) {
      closeList();
      xml += `<h2>${inlineMarkdown(line.slice(4))}</h2>\n`;
    } else if (line.startsWith('- ')) {
      if (!listOpen) {
        xml += '<ul>\n';
        listOpen = true;
      }
      xml += `<li>${inlineMarkdown(line.slice(2))}</li>\n`;
    } else if (line === '---') {
      closeList();
      xml += '<hr/>\n';
    } else {
      closeList();
      xml += `<p>${inlineMarkdown(line)}</p>\n`;
    }
  }
  closeList();
  return xml;
}

function buildWeeklyDraftFromDailyDir(dir) {
  const files = readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
  if (!files.length) throw new Error(`No markdown files found in ${dir}`);
  const allItems = [];
  const summaries = [];
  for (const file of files) {
    const md = readFileSync(join(dir, file), 'utf8');
    summaries.push(extractSummary(md));
    allItems.push(...extractDailyItems(md));
  }
  const redItems = allItems.filter((item) => item.signal === '🔴').slice(0, 12);
  const boards = new Map();
  for (const item of allItems) {
    const key = item.board || '其他';
    boards.set(key, (boards.get(key) || 0) + 1);
  }
  const topBoards = [...boards.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `# AI周报｜本周最值得看的 ${Math.max(3, topBoards.length)} 条线

本周 AI 新闻由 ${files.length} 份日报汇总而来。主线不是单点模型发布，而是模型、Agent、基础设施、内容生产和商业化继续进入真实任务链条。

${summaries.filter(Boolean).slice(0, 3).join('\n\n')}

---

${topBoards.map(([board, count], index) => `## 趋势${'一二三四五六七八九十'[index]}：${board} 是本周最密集的信号区

本周该方向累计出现 ${count} 条有效信号。它值得继续观察，因为高频出现通常意味着产品发布、基础设施成熟或商业化节奏正在加快。

**相关信号：**

${allItems.filter((item) => (item.board || '其他') === board).slice(0, 5).map((item) => `- ${item.signal || '🟡'} ${item.title}：${item.summary}${item.url ? ` 详情链接：${item.url}` : ''}`).join('\n')}
`).join('\n---\n')}

---

## 本周结论：日报信号需要沉淀成下周 watchlist

${redItems.length ? redItems.map((item, index) => `${index + 1}. ${item.title}`).join('\n') : '1. 本周未检测到足够多的红色信号，建议下周提高对官方博客和 Builder Feed 的巡检权重。'}
`;
}

let weeklyMarkdown = '';
if (args['weekly-md']) {
  weeklyMarkdown = readFileSync(args['weekly-md'], 'utf8');
} else if (args['daily-dir']) {
  weeklyMarkdown = buildWeeklyDraftFromDailyDir(args['daily-dir']);
} else {
  throw new Error('Provide --weekly-md for an existing weekly article or --daily-dir to build one from daily Markdown files.');
}

mkdirSync(dirname(outMd), { recursive: true });
mkdirSync(dirname(outHtml), { recursive: true });
mkdirSync(dirname(outXml), { recursive: true });
writeFileSync(outMd, weeklyMarkdown);
writeFileSync(outHtml, renderMarkdownToWechat(weeklyMarkdown));
writeFileSync(outXml, renderMarkdownToFeishuXml(weeklyMarkdown));
console.log(`Wrote ${outMd}`);
console.log(`Wrote ${outHtml}`);
console.log(`Wrote ${outXml}`);
