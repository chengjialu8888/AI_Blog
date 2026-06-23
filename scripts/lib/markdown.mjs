import { stripMarkdown } from './text.mjs';

export function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim() || 'AI Report';
  const sections = [];
  let current = { level: 0, title: 'intro', lines: [] };

  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      sections.push(current);
      current = {
        level: match[1].length,
        title: stripMarkdown(match[2]),
        lines: [],
      };
    } else if (!line.startsWith('# ')) {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return { title, sections };
}

export function extractSummary(markdown) {
  const { sections } = parseSections(markdown);
  const target = sections.find((section) => /一句话|TLDR|总结/.test(section.title));
  if (!target) return '';
  return target.lines
    .filter((line) => line.trim() && !/^[-*]\s*$/.test(line.trim()))
    .map((line) => stripMarkdown(line))
    .join(' ')
    .slice(0, 220);
}

export function extractDailyItems(markdown) {
  const { sections } = parseSections(markdown);
  const items = [];
  let activeBoard = '';

  for (const section of sections) {
    if (section.level === 3) activeBoard = section.title;
    for (let i = 0; i < section.lines.length; i += 1) {
      const line = section.lines[i].trim();
      const titleMatch = line.match(/^\*\*(?:\d+\.|[BN]\d+\.)?\s*(.+?)\*\*\s*([🔴🟡⚪])?/u);
      if (!titleMatch) continue;
      const body = [];
      let url = '';
      for (let j = i + 1; j < section.lines.length; j += 1) {
        const next = section.lines[j].trim();
        if (/^\*\*(?:\d+\.|[BN]\d+\.)?/.test(next) || /^###\s+/.test(next)) break;
        const linkMatch = next.match(/\((https?:\/\/[^)]+)\)/);
        if (linkMatch && !url) url = linkMatch[1];
        if (next && !next.startsWith('> 来源')) body.push(next);
      }
      items.push({
        title: stripMarkdown(titleMatch[1]),
        signal: titleMatch[2] || (line.includes('🔴') ? '🔴' : line.includes('🟡') ? '🟡' : '⚪'),
        board: activeBoard || section.title,
        summary: stripMarkdown(body.join(' ')).slice(0, 260),
        url,
      });
    }
  }
  return items;
}

export function extractWeeklyTrends(markdown) {
  const { sections } = parseSections(markdown);
  return sections
    .filter((section) => /^趋势/.test(section.title))
    .map((section) => ({
      title: section.title.replace(/^趋势[一二三四五六七八九十]+：/, ''),
      body: section.lines.filter((line) => line.trim() && !line.trim().startsWith('- ')),
      signals: section.lines.filter((line) => line.trim().startsWith('- ')),
    }));
}
