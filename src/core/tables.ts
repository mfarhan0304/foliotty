import type { TextItem } from './pdf-service.js';
import type { StyledLine } from './structure.js';

function cleanText(text: string): string {
  return text
    .replace(/[\uE000-\uF8FF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
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

export function renderAsciiTable(
  headerCells: string[],
  dataCells: string[],
): string[] {
  const widths = headerCells.map((header, index) =>
    Math.max(header.length, dataCells[index]?.length ?? 0),
  );
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const renderRow = (cells: string[]) =>
    `| ${widths
      .map((width, index) => (cells[index] ?? '').padEnd(width))
      .join(' | ')} |`;

  return [border, renderRow(headerCells), border, renderRow(dataCells), border];
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
