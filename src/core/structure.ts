import type { ColumnLayout } from './columns.js';
import type { TextItem } from './pdf-service.js';
import {
  detectAlignedTable,
  isTableLikeLine,
  postProcessTables,
  renderTableBlock,
  tableAwareSpacing,
} from './tables.js';

export type StyledRun = {
  bold: boolean;
  italic: boolean;
  text: string;
};

export type StyledLine = {
  kind: 'h1' | 'h2' | 'body' | 'bullet' | 'blank';
  runs: StyledRun[];
  text: string;
};

type LineGroup = {
  items: TextItem[];
  maxFontSize: number;
  y: number;
};

const BULLET_MARKERS = new Set(['•', '·', '-', '*', '○', '◦', '▪', '‣', '–']);
const PRIVATE_USE_CODEPOINT = /[\uE000-\uF8FF]/gu;

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }

  return sorted[middle] ?? 0;
}

function dominantSize(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const buckets = new Map<number, number>();

  for (const value of values) {
    const rounded = Number(value.toFixed(2));
    buckets.set(rounded, (buckets.get(rounded) ?? 0) + 1);
  }

  return (
    [...buckets.entries()].sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }

      return left[0] - right[0];
    })[0]?.[0] ?? 0
  );
}

function cleanText(text: string): string {
  return text.replace(PRIVATE_USE_CODEPOINT, '').replace(/\s+/gu, ' ').trim();
}

function isBulletMarker(text: string): boolean {
  return BULLET_MARKERS.has(cleanText(text));
}

function isBoldFont(fontName: string): boolean {
  return /bold|heavy|black|demi|semibold/i.test(fontName);
}

function isItalicFont(fontName: string): boolean {
  return /italic|oblique/i.test(fontName);
}

function lineTolerance(items: TextItem[]): number {
  return Math.max(2, median(items.map((item) => item.height)) * 0.6);
}

function spacingBetween(
  previous: TextItem,
  current: TextItem,
  tableLike: boolean,
): string {
  const previousRight = previous.x + previous.width;
  const gap = current.x - previousRight;
  const tableSpacing = tableAwareSpacing(previous, current, tableLike);

  if (tableSpacing !== null) {
    return tableSpacing;
  }

  return gap > Math.max(2, previous.fontSize * 0.2) ? ' ' : '';
}

function hasTableColumnGap(items: TextItem[]): boolean {
  const contentItems = items
    .filter((item) => cleanText(item.str).length > 0)
    .sort((left, right) => left.x - right.x);

  for (let index = 1; index < contentItems.length; index += 1) {
    const previous = contentItems[index - 1];
    const current = contentItems[index];

    if (previous === undefined || current === undefined) {
      continue;
    }

    const previousRight = previous.x + previous.width;
    const gap = current.x - previousRight;

    if (gap > Math.max(16, previous.fontSize * 1.5)) {
      return true;
    }
  }

  return false;
}

function groupItemsIntoLines(items: TextItem[]): LineGroup[] {
  if (items.length === 0) {
    return [];
  }

  const tolerance = lineTolerance(items);
  const lines: LineGroup[] = [];

  for (const item of items) {
    const text = cleanText(item.str);

    if (text.length === 0 && !isBulletMarker(item.str)) {
      continue;
    }

    const currentLine = lines.at(-1);

    if (!currentLine || Math.abs(currentLine.y - item.y) > tolerance) {
      lines.push({
        items: [item],
        maxFontSize: item.fontSize,
        y: item.y,
      });
      continue;
    }

    currentLine.items.push(item);
    currentLine.maxFontSize = Math.max(currentLine.maxFontSize, item.fontSize);
    currentLine.y = Math.max(currentLine.y, item.y);
  }

  return lines.map((line) => ({
    ...line,
    items: [...line.items].sort((left, right) => left.x - right.x),
  }));
}

function headingThreshold(lines: LineGroup[]): {
  bodyFontSize: number;
  h1FontSize: number;
  h2FontSize: number;
} {
  const fontSizes = lines
    .map((line) => line.maxFontSize)
    .filter((size) => size > 0);
  const distinctSizes = [
    ...new Set(fontSizes.map((size) => Number(size.toFixed(2)))),
  ].sort((left, right) => right - left);
  const bodyCandidates =
    distinctSizes.length > 1
      ? fontSizes.filter(
          (size) => Number(size.toFixed(2)) < (distinctSizes[0] ?? 0),
        )
      : fontSizes;
  const bodyFontSize = dominantSize(bodyCandidates);
  const h1FontSize = distinctSizes[0] ?? 0;
  const h2FontSize =
    distinctSizes.find(
      (size) => size < h1FontSize && size > bodyFontSize * 1.2,
    ) ?? 0;

  return {
    bodyFontSize,
    h1FontSize,
    h2FontSize,
  };
}

function lineKind(
  line: LineGroup,
  thresholds: { bodyFontSize: number; h1FontSize: number; h2FontSize: number },
  bullet: boolean,
): 'h1' | 'h2' | 'body' | 'bullet' {
  if (bullet) {
    return 'bullet';
  }

  if (
    thresholds.h1FontSize > thresholds.bodyFontSize * 1.2 &&
    line.maxFontSize >= thresholds.h1FontSize
  ) {
    return 'h1';
  }

  if (
    thresholds.h2FontSize > thresholds.bodyFontSize * 1.2 &&
    line.maxFontSize >= thresholds.h2FontSize
  ) {
    return 'h2';
  }

  return 'body';
}

function makeRuns(items: TextItem[], bullet: boolean): StyledRun[] {
  const runs: StyledRun[] = [];
  const tableLike = isTableLikeLine(items);

  if (bullet) {
    runs.push({
      bold: false,
      italic: false,
      text: '  • ',
    });
  }

  let previousContentItem: TextItem | undefined;

  for (const item of items) {
    if (bullet && isBulletMarker(item.str)) {
      continue;
    }

    const text = cleanText(item.str);

    if (text.length === 0) {
      continue;
    }

    const prefix =
      previousContentItem === undefined
        ? ''
        : spacingBetween(previousContentItem, item, tableLike);

    runs.push({
      bold: isBoldFont(item.fontName),
      italic: isItalicFont(item.fontName),
      text: `${prefix}${text}`,
    });

    previousContentItem = item;
  }

  return runs;
}

function plainStyledLine(text: string): StyledLine {
  return {
    kind: 'body',
    runs: text.length === 0 ? [] : [{ bold: false, italic: false, text }],
    text,
  };
}

function isTableCandidate(line: LineGroup): boolean {
  return line.items.length >= 2 && hasTableColumnGap(line.items);
}

function detectTableAt(
  lines: LineGroup[],
  startIndex: number,
): {
  renderedLines: StyledLine[];
  endIndex: number;
  lastLine: LineGroup;
} | null {
  const candidateLines: LineGroup[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined || !isTableCandidate(line)) {
      break;
    }

    candidateLines.push(line);
  }

  if (candidateLines.length < 3) {
    return null;
  }

  const table = detectAlignedTable(
    candidateLines.flatMap((line) => line.items),
  );

  if (table === null || table.rows.length < 3) {
    return null;
  }

  const lastLine = candidateLines.at(-1);

  if (lastLine === undefined) {
    return null;
  }

  return {
    endIndex: startIndex + candidateLines.length - 1,
    lastLine,
    renderedLines: renderTableBlock(table).map(plainStyledLine),
  };
}

export function buildStyledLines(layout: ColumnLayout): StyledLine[] {
  const lines = groupItemsIntoLines(layout.orderedItems);
  const thresholds = headingThreshold(lines);
  const bodyLineHeights = lines
    .filter((line) => line.maxFontSize <= thresholds.bodyFontSize * 1.1)
    .map((line) => median(line.items.map((item) => item.height)));
  const medianLineHeight = median(bodyLineHeights) || thresholds.bodyFontSize;
  const result: StyledLine[] = [];
  let previousLine: LineGroup | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === undefined) {
      continue;
    }

    const table = detectTableAt(lines, index);

    if (table !== null) {
      if (
        previousLine &&
        previousLine.y > line.y &&
        previousLine.y - line.y > medianLineHeight * 1.5
      ) {
        result.push({
          kind: 'blank',
          runs: [],
          text: '',
        });
      }

      result.push(...table.renderedLines);
      previousLine = table.lastLine;
      index = table.endIndex;
      continue;
    }

    const bullet = line.items.some(
      (item, index) => index === 0 && isBulletMarker(item.str),
    );
    const runs = makeRuns(line.items, bullet);
    const text = runs.map((run) => run.text).join('');

    if (text.trim().length === 0) {
      continue;
    }

    if (
      previousLine &&
      previousLine.y > line.y &&
      previousLine.y - line.y > medianLineHeight * 1.5
    ) {
      result.push({
        kind: 'blank',
        runs: [],
        text: '',
      });
    }

    result.push({
      kind: lineKind(line, thresholds, bullet),
      runs,
      text,
    });

    previousLine = line;
  }

  return postProcessTables(result);
}
