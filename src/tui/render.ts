import chalk from 'chalk';

import type { StyledLine, StyledRun } from '../core/structure.js';
import { safeTerminalTextColor } from './color.js';

export type HighlightRange = {
  end: number;
  start: number;
};

function applyRunStyles(text: string, run: StyledRun): string {
  let styled = text;
  const safeColor = safeTerminalTextColor(run.color);

  if (safeColor !== null) {
    styled = chalk.hex(safeColor)(styled);
  }

  if (run.bold) {
    styled = chalk.bold(styled);
  }

  if (run.italic) {
    styled = chalk.italic(styled);
  }

  return styled;
}

function applyLineKind(text: string, line: StyledLine): string {
  if (line.kind === 'h1') {
    return chalk.bold.cyan.underline(text);
  }

  if (line.kind === 'h2') {
    return chalk.bold.yellow(text);
  }

  return text;
}

function overlap(
  start: number,
  end: number,
  range: HighlightRange,
): HighlightRange | null {
  const overlapStart = Math.max(start, range.start);
  const overlapEnd = Math.min(end, range.end);

  if (overlapStart >= overlapEnd) {
    return null;
  }

  return {
    end: overlapEnd,
    start: overlapStart,
  };
}

function rangesEqual(
  left: HighlightRange,
  right: HighlightRange | null,
): boolean {
  return right !== null && left.start === right.start && left.end === right.end;
}

export function renderStyledLine(
  line: StyledLine,
  highlightRanges: HighlightRange[] = [],
  activeHighlightRange: HighlightRange | null = null,
): string {
  if (line.kind === 'blank') {
    return '';
  }

  let offset = 0;
  const renderedRuns = line.runs.map((run) => {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    const overlappingRanges = highlightRanges
      .map((range) => overlap(runStart, runEnd, range))
      .filter((range): range is HighlightRange => range !== null)
      .sort((left, right) => left.start - right.start);

    offset = runEnd;

    if (overlappingRanges.length === 0) {
      return applyLineKind(applyRunStyles(run.text, run), line);
    }

    let cursor = runStart;
    let rendered = '';

    for (const range of overlappingRanges) {
      if (cursor < range.start) {
        rendered += applyLineKind(
          applyRunStyles(
            run.text.slice(cursor - runStart, range.start - runStart),
            run,
          ),
          line,
        );
      }

      const styled = applyLineKind(
        applyRunStyles(
          run.text.slice(range.start - runStart, range.end - runStart),
          run,
        ),
        line,
      );
      const isActive = rangesEqual(range, activeHighlightRange);

      rendered += isActive
        ? chalk.bgHex('#ffa500').black(styled)
        : chalk.bgYellow.black(styled);
      cursor = range.end;
    }

    if (cursor < runEnd) {
      rendered += applyLineKind(
        applyRunStyles(run.text.slice(cursor - runStart), run),
        line,
      );
    }

    return rendered;
  });

  return renderedRuns.join('');
}

export function renderStyledLineSlice(
  line: StyledLine,
  start: number,
  end: number,
  highlightRanges: HighlightRange[] = [],
  activeHighlightRange: HighlightRange | null = null,
): string {
  if (line.kind === 'blank') {
    return '';
  }

  let offset = 0;
  const runs: StyledRun[] = [];

  for (const run of line.runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    const sliceStart = Math.max(start, runStart);
    const sliceEnd = Math.min(end, runEnd);

    if (sliceStart < sliceEnd) {
      const slicedRun: StyledRun = {
        bold: run.bold,
        italic: run.italic,
        text: run.text.slice(sliceStart - runStart, sliceEnd - runStart),
      };

      if (run.color !== undefined) {
        slicedRun.color = run.color;
      }

      runs.push(slicedRun);
    }

    offset = runEnd;
  }

  const shiftedRanges = highlightRanges
    .map((range) => ({
      end: Math.min(end, range.end) - start,
      start: Math.max(start, range.start) - start,
    }))
    .filter((range) => range.start < range.end);

  const shiftedActive =
    activeHighlightRange === null
      ? null
      : (() => {
          const active = {
            end: Math.min(end, activeHighlightRange.end) - start,
            start: Math.max(start, activeHighlightRange.start) - start,
          };
          return active.start < active.end ? active : null;
        })();

  return renderStyledLine(
    {
      ...line,
      runs,
      text: line.text.slice(start, end),
    },
    shiftedRanges,
    shiftedActive,
  );
}
