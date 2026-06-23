#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { parseCsv } from './lib/csv.mjs';
import { extractDailyItems, extractSummary } from './lib/markdown.mjs';
import { escapeHtml, inlineMarkdown, slugDate, stripMarkdown } from './lib/text.mjs';

const args = parseArgs(process.argv.slice(2));
const markdownPath = requireArg(args, 'markdown', 'AI_News_Digest generated Markdown');
const outPath = requireArg(args, 'out', 'output HTML path');
const csvPath = args.csv;
const templatePath = args.template || 'templates/daily-wechat-template.json';

const markdown = readFileSync(markdownPath, 'utf8');
const template = JSON.parse(readFileSync(templatePath, 'utf8'));
const csvItems = csvPath ? parseCsv(readFileSync(csvPath, 'utf8')) : [];

const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || '每日 AI 速递';
const subtitle = markdown.match(/时间窗[:：]\s*(.+)$/m)?.[1]?.trim() || '';
const date = slugDate(title) || slugDate(subtitle) || new Date().toISOString().slice(0, 10);
const summary = extractSummary(markdown);
const mdItems = extractDailyItems(markdown);

function signalOf(item) {
  const raw = item.signal || item['信号等级'] || item['信号'] || item['等级'] || '';
  if (String(raw).includes('🔴') || /高|重磅|high/i.test(raw)) return 'high';
  if (String(raw).includes('🟡') || /中|关注|medium/i.test(raw)) return 'medium';
  return 'info';
}

function normalizeCsvItem(row) {
  return {
    title: row['标题'] || row.title || '',
    board: row['板块'] || row.board || '',
    summary: row['摘要'] || row.summary || '',
    url: row['原文URL'] || row.url || row['来源链接'] || '',
    source: row['来源'] || row.source || '',
    signal: row['信号等级'] || row.signal || '',
  };
}

const rawItems = csvItems.length ? csvItems.map(normalizeCsvItem) : mdItems;
const items = rawItems.filter((item) => item.title);
const config = template.config || {};
const colors = config.accentColors || {};
const fonts = config.fonts || {};
const fontFamily = fonts.family || "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";

const sectionOrder = ['大厂动向', '初创动向', '生态动向', '技术博客&论文', '观点与深度', '海外建设者', '养虾实践'];
const grouped = new Map();
for (const item of items) {
  const board = item.board || '其他';
  if (!grouped.has(board)) grouped.set(board, []);
  grouped.get(board).push(item);
}

function sectionHtml(name, sectionItems) {
  const body = sectionItems
    .map((item, index) => {
      const sig = signalOf(item);
      const icon = sig === 'high' ? '🔴' : sig === 'medium' ? '🟡' : '⚪';
      const color = sig === 'high' ? colors.highImpact || '#e74c3c' : sig === 'medium' ? colors.mediumImpact || '#f39c12' : colors.infoStream || '#bbbbbb';
      const url = item.url ? `<p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:${config.mutedTextColor || '#999999'};">来源：<a href="${escapeHtml(item.url)}" style="color:${config.mutedTextColor || '#999999'};text-decoration:none;word-break:break-all;">${escapeHtml(item.source || item.url)}</a></p>` : '';
      return `<section style="margin:0 0 22px 0;padding:0 0 18px 0;border-bottom:1px solid ${config.borderColor || '#e0e0e0'};">
  <p style="margin:0 0 8px 0;font-size:14px;line-height:1.65;color:${config.textColor || '#1a1a1a'};">
    <span style="color:${color};font-size:12px;">${icon}</span>
    <strong>${index + 1}. ${inlineMarkdown(item.title)}</strong>
  </p>
  <p style="margin:0;font-size:14px;line-height:1.85;color:${config.secondaryTextColor || '#555555'};">${inlineMarkdown(item.summary || '')}</p>
  ${url}
</section>`;
    })
    .join('\n');

  return `<section style="margin:${config.spacing?.sectionGap || '36px'} 0 0 0;">
  <p style="margin:0 0 18px 0;padding-left:10px;border-left:${config.borders?.accentBar || '3px solid #1a1a1a'};font-size:${fonts.sizes?.subtitle || '17px'};font-weight:${fonts.weights?.bold || 700};letter-spacing:0;color:${config.textColor || '#1a1a1a'};">${escapeHtml(name)}</p>
  ${body}
</section>`;
}

const orderedSections = [
  ...sectionOrder.filter((name) => grouped.has(name)),
  ...[...grouped.keys()].filter((name) => !sectionOrder.includes(name)),
];

const legend = `<section style="background:#fafafa;border-radius:6px;padding:12px 16px;margin:24px 0;text-align:center;font-size:12px;color:${config.mutedTextColor || '#999999'};">
  <span style="color:${colors.highImpact || '#e74c3c'};">🔴 高影响</span>
  <span style="margin-left:14px;color:${colors.mediumImpact || '#f39c12'};">🟡 中影响</span>
  <span style="margin-left:14px;color:${colors.infoStream || '#bbbbbb'};">⚪ 信息流</span>
</section>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(stripMarkdown(title))}</title>
</head>
<body style="margin:0;background:${config.backgroundColor || '#ffffff'};">
  <main style="max-width:${config.maxWidth || '580px'};margin:0 auto;padding:${config.spacing?.padding?.vertical || '32px'} ${config.spacing?.padding?.horizontal || '24px'};font-family:${fontFamily};color:${config.textColor || '#1a1a1a'};">
    <header style="text-align:center;margin-bottom:28px;">
      <p style="margin:0;font-size:11px;color:${config.mutedTextColor || '#999999'};letter-spacing:0.25em;text-transform:uppercase;">AI Daily Digest</p>
      <h1 style="margin:12px 0 0 0;font-size:${fonts.sizes?.title || '22px'};line-height:1.45;font-weight:${fonts.weights?.bold || 700};">${inlineMarkdown(title)}</h1>
      <p style="margin:8px 0 0 0;font-size:${fonts.sizes?.caption || '13px'};line-height:1.6;color:${config.mutedTextColor || '#999999'};">${escapeHtml(subtitle || date)}</p>
      <div style="width:40px;height:1px;background:#d0d0d0;margin:20px auto 0;"></div>
    </header>
    ${summary ? `<section style="margin:0 0 26px 0;font-size:14px;line-height:1.85;color:${config.secondaryTextColor || '#555555'};"><strong>一句话总结：</strong>${inlineMarkdown(summary)}</section>` : ''}
    ${legend}
    ${orderedSections.map((name) => sectionHtml(name, grouped.get(name))).join('\n')}
    <footer style="margin:38px 0 0 0;padding-top:18px;border-top:1px solid ${config.borderColor || '#e0e0e0'};font-size:12px;line-height:1.7;color:${config.mutedTextColor || '#999999'};text-align:center;">
      Generated by AI_Blog workflow. Source data from AI_News_Digest.
    </footer>
  </main>
</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
console.log(`Items: ${items.length}`);
