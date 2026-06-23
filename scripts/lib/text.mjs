export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function inlineMarkdown(value = '') {
  let s = escapeHtml(String(value).trim());
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  s = s.replace(/\[\[([^\]]+?)\]\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\[([^\]]+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

export function stripMarkdown(value = '') {
  return String(value)
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugDate(value = '') {
  const match = String(value).match(/\d{4}[-年]\d{1,2}[-月]\d{1,2}/);
  if (!match) return '';
  return match[0].replace(/[年月]/g, '-').replace(/日/g, '').replace(/-(\d)(?=-|$)/g, '-0$1');
}

export function firstNonEmpty(lines) {
  return lines.find((line) => line.trim())?.trim() || '';
}
