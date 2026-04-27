import type { StyledLine } from './structure.js';
import type { TextItem } from './pdf-service.js';

export type SearchHit = {
  lineIndex: number;
  range: { end: number; start: number };
};

export type SearchIndex = {
  indexedLineCount: number;
  normalizedLines: Map<number, string>;
  trigrams: Map<string, Set<number>>;
};

export type SearchRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type PageSearchHit = {
  pageIndex: number;
  rects: SearchRect[];
};

function stripPrivateUse(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/gu, '');
}

export function normalizeSearchText(text: string): string {
  return stripPrivateUse(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function trigramsFor(text: string): Set<string> {
  const trigrams = new Set<string>();

  for (let index = 0; index <= text.length - 3; index += 1) {
    trigrams.add(text.slice(index, index + 3));
  }

  return trigrams;
}

function rangesForLine(normalizedText: string, normalizedQuery: string) {
  const ranges: Array<{ end: number; start: number }> = [];
  let searchOffset = 0;

  while (searchOffset <= normalizedText.length - normalizedQuery.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchOffset);

    if (matchIndex === -1) {
      break;
    }

    ranges.push({
      end: matchIndex + normalizedQuery.length,
      start: matchIndex,
    });
    searchOffset = matchIndex + Math.max(1, normalizedQuery.length);
  }

  return ranges;
}

export function createSearchIndex(lines: StyledLine[]): SearchIndex {
  const normalizedLines = new Map<number, string>();
  const trigrams = new Map<string, Set<number>>();

  for (const [lineIndex, line] of lines.entries()) {
    if (line.kind === 'blank') {
      continue;
    }

    const normalizedText = normalizeSearchText(line.text);

    if (normalizedText.length === 0) {
      continue;
    }

    normalizedLines.set(lineIndex, normalizedText);

    for (const trigram of trigramsFor(normalizedText)) {
      const lineIndexes = trigrams.get(trigram) ?? new Set<number>();
      lineIndexes.add(lineIndex);
      trigrams.set(trigram, lineIndexes);
    }
  }

  return {
    indexedLineCount: normalizedLines.size,
    normalizedLines,
    trigrams,
  };
}

function candidateLineIndexes(index: SearchIndex, normalizedQuery: string) {
  if (normalizedQuery.length < 3) {
    return [...index.normalizedLines.keys()];
  }

  const queryTrigrams = [...trigramsFor(normalizedQuery)];
  const [firstTrigram, ...remainingTrigrams] = queryTrigrams;

  if (!firstTrigram) {
    return [];
  }

  const firstCandidates = index.trigrams.get(firstTrigram);

  if (!firstCandidates) {
    return [];
  }

  let candidates = new Set(firstCandidates);

  for (const trigram of remainingTrigrams) {
    const matchingLines = index.trigrams.get(trigram);

    if (!matchingLines) {
      return [];
    }

    candidates = new Set(
      [...candidates].filter((lineIndex) => matchingLines.has(lineIndex)),
    );

    if (candidates.size === 0) {
      return [];
    }
  }

  return [...candidates].sort((left, right) => left - right);
}

export function searchStyledLines(
  lines: StyledLine[],
  query: string,
): SearchHit[] {
  return searchIndexedLines(createSearchIndex(lines), query);
}

export function searchIndexedLines(
  index: SearchIndex,
  query: string,
): SearchHit[] {
  const normalizedQuery = normalizeSearchText(query).trim();

  if (normalizedQuery.length === 0) {
    return [];
  }

  const hits: SearchHit[] = [];

  for (const lineIndex of candidateLineIndexes(index, normalizedQuery)) {
    const normalizedText = index.normalizedLines.get(lineIndex);

    if (normalizedText === undefined) {
      continue;
    }

    const ranges = rangesForLine(normalizedText, normalizedQuery);

    for (const range of ranges) {
      hits.push({
        lineIndex,
        range,
      });
    }
  }

  return hits;
}

export function searchTextItems(
  pages: TextItem[][],
  query: string,
): PageSearchHit[] {
  const normalizedQuery = normalizeSearchText(query).trim();

  if (normalizedQuery.length === 0) {
    return [];
  }

  const hits: PageSearchHit[] = [];

  for (const [pageIndex, pageItems] of pages.entries()) {
    for (const item of pageItems) {
      const normalizedText = normalizeSearchText(item.str);
      const ranges = rangesForLine(normalizedText, normalizedQuery);

      for (const range of ranges) {
        const startRatio = range.start / Math.max(1, normalizedText.length);
        const endRatio = range.end / Math.max(1, normalizedText.length);

        hits.push({
          pageIndex,
          rects: [
            {
              height: item.height,
              width: item.width * (endRatio - startRatio),
              x: item.x + item.width * startRatio,
              y: item.y,
            },
          ],
        });
      }
    }
  }

  return hits;
}
