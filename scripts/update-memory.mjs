#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { extractDailyItems } from './lib/markdown.mjs';

const args = parseArgs(process.argv.slice(2));
const markdownPath = requireArg(args, 'markdown');
const memoryPath = args.memory || 'memory/covered-events.json';
const markdown = readFileSync(markdownPath, 'utf8');
const items = extractDailyItems(markdown);
const now = new Date().toISOString();
const existing = existsSync(memoryPath) ? JSON.parse(readFileSync(memoryPath, 'utf8')) : { events: [] };
const seen = new Set(existing.events.map((event) => event.key));

for (const item of items) {
  const key = `${item.title}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 180);
  if (seen.has(key)) continue;
  existing.events.push({
    key,
    title: item.title,
    board: item.board,
    signal: item.signal,
    url: item.url,
    first_seen_at: now,
  });
}

existing.updated_at = now;
existing.events = existing.events.slice(-800);
mkdirSync(dirname(memoryPath), { recursive: true });
writeFileSync(memoryPath, JSON.stringify(existing, null, 2));
console.log(`Updated ${memoryPath}: ${existing.events.length} events`);
