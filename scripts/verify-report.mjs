#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from './lib/args.mjs';
import { parseCsv } from './lib/csv.mjs';
import { extractDailyItems } from './lib/markdown.mjs';

const args = parseArgs(process.argv.slice(2));
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

if (args.markdown) {
  check(existsSync(args.markdown), `Markdown not found: ${args.markdown}`);
  if (existsSync(args.markdown)) {
    const markdown = readFileSync(args.markdown, 'utf8');
    check(/^#\s+/.test(markdown), 'Markdown must start with an H1 title.');
    warn(/一句话总结|TLDR|本周结论/.test(markdown), 'Markdown has no summary section.');
    warn(/https?:\/\//.test(markdown), 'Markdown has no source links.');
    const items = extractDailyItems(markdown);
    warn(items.length >= 5, `Only ${items.length} structured news items detected.`);
  }
}

if (args.csv) {
  check(existsSync(args.csv), `CSV not found: ${args.csv}`);
  if (existsSync(args.csv)) {
    const rows = parseCsv(readFileSync(args.csv, 'utf8'));
    check(rows.length > 0, 'CSV has no rows.');
    const titleKey = Object.keys(rows[0] || {}).find((key) => /标题|title/i.test(key));
    const urlKey = Object.keys(rows[0] || {}).find((key) => /URL|url|链接/.test(key));
    check(Boolean(titleKey), 'CSV has no title column.');
    check(Boolean(urlKey), 'CSV has no URL column.');
    if (urlKey) {
      const badUrls = rows.filter((row) => row[urlKey] && !/^https?:\/\//.test(row[urlKey]));
      check(badUrls.length === 0, `CSV has ${badUrls.length} non-http URL values.`);
    }
  }
}

if (args.html) {
  check(existsSync(args.html), `HTML not found: ${args.html}`);
  if (existsSync(args.html)) {
    const html = readFileSync(args.html, 'utf8');
    check(/<!doctype html>/i.test(html), 'HTML must include doctype.');
    check(/<main/i.test(html), 'HTML must include a main container.');
    warn(!/undefined|null/.test(html), 'HTML contains undefined/null text.');
  }
}

if (args.xml) {
  check(existsSync(args.xml), `Feishu XML not found: ${args.xml}`);
  if (existsSync(args.xml)) {
    const xml = readFileSync(args.xml, 'utf8');
    check(/<title>/.test(xml), 'Feishu XML must include <title>.');
    warn(!/undefined|null/.test(xml), 'Feishu XML contains undefined/null text.');
  }
}

const result = { ok: failures.length === 0, failures, warnings };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
