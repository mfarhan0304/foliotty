import type { StyledLine } from './structure.js';

export type SearchHit = {
  lineIndex: number;
  ranges: Array<{ end: number; start: number }>;
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

export function searchStyledLines(
  lines: StyledLine[],
  query: string,
): SearchHit[] {
  const normalizedQuery = normalizeSearchText(query).trim();

  if (normalizedQuery.length === 0) {
    return [];
  }

  const hits: SearchHit[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    if (line.kind === 'blank') {
      continue;
    }

    const normalizedText = normalizeSearchText(line.text);
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

    if (ranges.length > 0) {
      hits.push({
        lineIndex,
        ranges,
      });
    }
  }

  return hits;
}
