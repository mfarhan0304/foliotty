import type { TextItem } from './pdf-service.js';
import type { StyledLine } from './structure.js';

export type TableBlock = {
  rows: string[][];
};

type TextRow = {
  items: TextItem[];
  y: number;
};

function cleanText(text: string): string {
  return text
    .replace(/[\uE000-\uF8FF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

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

function plainLine(
  text: string,
  kind: StyledLine['kind'] = 'body',
): StyledLine {
  return {
    kind,
    runs: text.length === 0 ? [] : [{ bold: false, italic: false, text }],
    text,
  };
}

export function isTableLikeLine(items: TextItem[]): boolean {
  if (items.length < 2) {
    return false;
  }

  const text = items.map((item) => cleanText(item.str)).join(' ');
  const firstText = cleanText(items[0]?.str ?? '');

  return (
    /^(table|head|subhead|text)\b/i.test(firstText) &&
    /\b(table|head|subhead|column|text)\b/i.test(text)
  );
}

export function tableAwareSpacing(
  previous: TextItem,
  current: TextItem,
  tableLike: boolean,
): string | null {
  const previousRight = previous.x + previous.width;
  const gap = current.x - previousRight;

  if (tableLike && gap > Math.max(16, previous.fontSize * 1.5)) {
    return ' | ';
  }

  return null;
}

function groupItemsByRow(items: TextItem[]): TextRow[] {
  const contentItems = items
    .filter((item) => cleanText(item.str).length > 0)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return right.y - left.y;
      }

      return left.x - right.x;
    });
  const tolerance = Math.max(
    2,
    median(contentItems.map((item) => item.height)) * 0.6,
  );
  const rows: TextRow[] = [];

  for (const item of contentItems) {
    const row = rows.find(
      (candidate) => Math.abs(candidate.y - item.y) <= tolerance,
    );

    if (row === undefined) {
      rows.push({ items: [item], y: item.y });
      continue;
    }

    row.items.push(item);
    row.y = Math.max(row.y, item.y);
  }

  return rows.map((row) => ({
    ...row,
    items: [...row.items].sort((left, right) => left.x - right.x),
  }));
}

function clusterAnchors(items: TextItem[], headerItems: TextItem[]): number[] {
  const tolerance = Math.max(
    12,
    median(items.map((item) => item.fontSize)) * 1.5,
  );
  const clusters: Array<{ count: number; x: number }> = [];

  for (const item of [...items].sort((left, right) => left.x - right.x)) {
    const cluster = clusters.find(
      (candidate) => Math.abs(candidate.x - item.x) <= tolerance,
    );

    if (cluster === undefined) {
      clusters.push({ count: 1, x: item.x });
      continue;
    }

    cluster.x = (cluster.x * cluster.count + item.x) / (cluster.count + 1);
    cluster.count += 1;
  }

  return clusters
    .filter(
      (cluster) =>
        cluster.count >= 2 ||
        headerItems.some((item) => Math.abs(item.x - cluster.x) <= tolerance),
    )
    .map((cluster) => cluster.x)
    .sort((left, right) => left - right);
}

function nearestAnchorIndex(anchors: number[], x: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [index, anchor] of anchors.entries()) {
    const distance = Math.abs(anchor - x);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export function detectAlignedTable(items: TextItem[]): TableBlock | null {
  const rows = groupItemsByRow(items).filter((row) => row.items.length >= 2);

  if (rows.length < 2) {
    return null;
  }

  const anchors = clusterAnchors(
    rows.flatMap((row) => row.items),
    rows[0]?.items ?? [],
  );

  if (anchors.length < 2) {
    return null;
  }

  const cellRows = rows.map((row) => {
    const cells = Array.from({ length: anchors.length }, () => '');

    for (const item of row.items) {
      const cellIndex = nearestAnchorIndex(anchors, item.x);
      const text = cleanText(item.str);
      cells[cellIndex] = [cells[cellIndex], text].filter(Boolean).join(' ');
    }

    return cells;
  });
  const alignedRows = cellRows.filter(
    (row) => row.filter((cell) => cell.length > 0).length >= 2,
  );

  if (alignedRows.length < 2) {
    return null;
  }

  return { rows: alignedRows };
}

function splitEmbeddedTableTitles(lines: StyledLine[]): StyledLine[] {
  const result: StyledLine[] = [];
  const tableTitle = 'Table Column Head';

  for (const line of lines) {
    if (line.text.endsWith(` ${tableTitle}`) && line.text !== tableTitle) {
      result.push(plainLine(line.text.slice(0, -tableTitle.length).trim()));
      result.push(plainLine(tableTitle));
      continue;
    }

    result.push(line);
  }

  return result;
}

function splitTableDataRow(text: string, cellCount: number): string[] {
  const cells = text.includes('|')
    ? text.split('|').map((cell) => cell.trim())
    : text.split(/\s+/u).filter((cell) => cell.length > 0);

  return Array.from({ length: cellCount }, (_, index) => cells[index] ?? '');
}

export function renderTableBlock(table: TableBlock): string[] {
  if (table.rows.length === 0) {
    return [];
  }

  const columnCount = Math.max(...table.rows.map((row) => row.length));
  const rows = table.rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? ''),
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...rows.map((row) => row[index]?.length ?? 0)),
  );
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const renderRow = (cells: string[]) =>
    `| ${widths
      .map((width, index) => (cells[index] ?? '').padEnd(width))
      .join(' | ')} |`;

  return [
    border,
    renderRow(rows[0] ?? []),
    border,
    ...rows.slice(1).map(renderRow),
    border,
  ];
}

export function renderAsciiTable(
  headerCells: string[],
  dataCells: string[],
): string[] {
  return renderTableBlock({ rows: [headerCells, dataCells] });
}

function nextNonBlankIndex(lines: StyledLine[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index]?.kind !== 'blank') {
      return index;
    }
  }

  return -1;
}

function renderSimpleTables(lines: StyledLine[]): StyledLine[] {
  const result: StyledLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const firstHeaderIndex = nextNonBlankIndex(lines, index + 1);
    const remainingHeaderIndex = nextNonBlankIndex(lines, firstHeaderIndex + 1);
    const dataIndex = nextNonBlankIndex(lines, remainingHeaderIndex + 1);
    const firstHeaderLine = lines[firstHeaderIndex];
    const remainingHeaderLine = lines[remainingHeaderIndex];
    const dataLine = lines[dataIndex];

    if (
      line?.text === 'Table Column Head' &&
      firstHeaderIndex !== -1 &&
      remainingHeaderIndex !== -1 &&
      dataIndex !== -1 &&
      firstHeaderLine?.text === 'Table' &&
      remainingHeaderLine?.text.includes('|') &&
      dataLine &&
      /\btext\b/i.test(dataLine.text)
    ) {
      const remainingHeaderCells = remainingHeaderLine.text
        .split('|')
        .map((cell) => cell.trim());
      const headerCells = [
        `${firstHeaderLine.text} ${remainingHeaderCells[0] ?? ''}`.trim(),
        ...remainingHeaderCells.slice(1),
      ];
      const dataCells = splitTableDataRow(dataLine.text, headerCells.length);

      result.push(line);
      result.push(
        ...renderAsciiTable(headerCells, dataCells).map((tableLine) =>
          plainLine(tableLine),
        ),
      );
      index = dataIndex;
      continue;
    }

    if (line) {
      result.push(line);
    }
  }

  return result;
}

export function postProcessTables(lines: StyledLine[]): StyledLine[] {
  return renderSimpleTables(splitEmbeddedTableTitles(lines));
}
