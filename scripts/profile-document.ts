import process from 'node:process';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';

import { detectColumns } from '../src/core/columns.js';
import { openPdf } from '../src/core/pdf-service.js';
import { createSearchIndex, searchIndexedLines } from '../src/core/search.js';
import { buildStyledLines } from '../src/core/structure.js';

type TimedResult<T> = {
  elapsedMs: number;
  value: T;
};

async function timed<T>(operation: () => Promise<T>): Promise<TimedResult<T>> {
  const start = performance.now();
  const value = await operation();

  return {
    elapsedMs: performance.now() - start,
    value,
  };
}

function timedSync<T>(operation: () => T): TimedResult<T> {
  const start = performance.now();
  const value = operation();

  return {
    elapsedMs: performance.now() - start,
    value,
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function usage(): string {
  return [
    'Usage',
    '  bun run profile <file.pdf> [search query]',
    '',
    'Examples',
    '  bun run profile samples/long.pdf',
    '  bun run profile samples/2-columns.pdf references',
  ].join('\n');
}

const [, , filePath, ...queryParts] = process.argv;

if (!filePath) {
  process.stderr.write(`${usage()}\n`);
  process.exit(1);
}

const query = queryParts.join(' ').trim() || 'the';

const documentResult = await timed(() => openPdf(filePath));
const document = documentResult.value;

const structureResult = timedSync(() =>
  document.pages.map((page) => buildStyledLines(detectColumns(page))),
);
const lines = structureResult.value.flat();
const indexResult = timedSync(() => createSearchIndex(lines));
const searchResult = timedSync(() =>
  searchIndexedLines(indexResult.value, query),
);
const totalMs =
  documentResult.elapsedMs +
  structureResult.elapsedMs +
  indexResult.elapsedMs +
  searchResult.elapsedMs;

const textItemCount = document.pages.reduce(
  (total, page) => total + page.length,
  0,
);
const lineCount = lines.length;

process.stdout.write(
  [
    `File: ${basename(filePath)}`,
    `Pages: ${document.numPages}`,
    `Text items: ${textItemCount}`,
    `Styled lines: ${lineCount}`,
    `Indexed lines: ${indexResult.value.indexedLineCount}`,
    `Search query: ${JSON.stringify(query)}`,
    `Search hits: ${searchResult.value.length}`,
    '',
    'Timings',
    `  PDF parse: ${formatMs(documentResult.elapsedMs)}`,
    `  Layout + structure: ${formatMs(structureResult.elapsedMs)}`,
    `  Search index build: ${formatMs(indexResult.elapsedMs)}`,
    `  First indexed search: ${formatMs(searchResult.elapsedMs)}`,
    `  Total measured: ${formatMs(totalMs)}`,
  ].join('\n'),
);
process.stdout.write('\n');
