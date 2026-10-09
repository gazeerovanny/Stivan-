#!/usr/bin/env node
// Копирует data/settings.csv и data/services.csv во встроенную копию внутри index.html.
// Запуск: node tools/sync-fallback.mjs          обновить копию
//         node tools/sync-fallback.mjs --check  только проверить, что копия совпадает с файлами
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
const checkOnly = process.argv.includes('--check');

let html = readFileSync(htmlPath, 'utf8');
const original = html;

for (const name of ['settings', 'services']) {
  const csv = readFileSync(join(root, 'data', `${name}.csv`), 'utf8')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (/<\/script/i.test(csv)) throw new Error(`data/${name}.csv содержит «</script», так нельзя`);

  const pattern = new RegExp(`(<!-- fallback:${name}:start -->)[\\s\\S]*?(<!-- fallback:${name}:end -->)`);
  if (!pattern.test(html)) throw new Error(`В index.html нет меток fallback:${name}`);
  html = html.replace(pattern, (_, start, end) =>
    `${start}\n  <script type="text/csv" id="fallback-${name}">\n${csv}\n  </script>\n  ${end}`);
}

if (checkOnly) {
  if (html !== original) {
    console.error('Встроенная копия отличается от data/*.csv. Запустите: node tools/sync-fallback.mjs');
    process.exit(1);
  }
  console.log('Встроенная копия совпадает с data/*.csv');
} else if (html !== original) {
  writeFileSync(htmlPath, html);
  console.log('Встроенная копия обновлена');
} else {
  console.log('Изменений нет');
}
