import type { StyledLine } from '../core/structure.js';

type Segment = {
  end: number;
  start: number;
};

function clampWidth(width: number): number {
  return Math.max(1, width);
}

export function wrapTextSegments(text: string, width: number): Segment[] {
  const maxWidth = clampWidth(width);

  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }

  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const rawEnd = Math.min(text.length, cursor + maxWidth);

    if (rawEnd === text.length) {
      segments.push({ start: cursor, end: rawEnd });
      break;
    }

    const candidate = text.slice(cursor, rawEnd);
    const lastSpace = candidate.lastIndexOf(' ');

    if (lastSpace > 0) {
      const segmentEnd = cursor + lastSpace;
      segments.push({ start: cursor, end: segmentEnd });
      cursor = segmentEnd;

      while (text[cursor] === ' ') {
        cursor += 1;
      }
      continue;
    }

    segments.push({ start: cursor, end: rawEnd });
    cursor = rawEnd;
  }

  return segments;
}

export function countWrappedRows(
  lines: StyledLine[],
  width: number,
  prefixWidth = 2,
): number {
  const contentWidth = clampWidth(width - prefixWidth);

  return lines.reduce(
    (total, line) => total + wrapTextSegments(line.text, contentWidth).length,
    0,
  );
}

export function rowOffsetForLine(
  lines: StyledLine[],
  lineIndex: number,
  width: number,
  prefixWidth = 2,
): number {
  const contentWidth = clampWidth(width - prefixWidth);
  let rows = 0;

  for (let index = 0; index < Math.min(lineIndex, lines.length); index += 1) {
    rows += wrapTextSegments(lines[index]?.text ?? '', contentWidth).length;
  }

  return rows;
}

export function lineIndexAtRowOffset(
  lines: StyledLine[],
  rowOffset: number,
  width: number,
  prefixWidth = 2,
): number {
  const contentWidth = clampWidth(width - prefixWidth);
  let rows = 0;

  for (const [index, line] of lines.entries()) {
    const lineRows = wrapTextSegments(line.text, contentWidth).length;

    if (rowOffset < rows + lineRows) {
      return index;
    }

    rows += lineRows;
  }

  return Math.max(0, lines.length - 1);
}
