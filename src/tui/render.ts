import chalk from 'chalk';

import type { StyledLine, StyledRun } from '../core/structure.js';

export type HighlightRange = {
  end: number;
  start: number;
};

function applyRunStyles(text: string, run: StyledRun): string {
  let styled = text;

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

export function renderStyledLine(
  line: StyledLine,
  highlightRanges: HighlightRange[] = [],
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

      rendered += chalk.bgYellow.black(
        applyLineKind(
          applyRunStyles(
            run.text.slice(range.start - runStart, range.end - runStart),
            run,
          ),
          line,
        ),
      );
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
      runs.push({
        bold: run.bold,
        italic: run.italic,
        text: run.text.slice(sliceStart - runStart, sliceEnd - runStart),
      });
    }

    offset = runEnd;
  }

  const shiftedRanges = highlightRanges
    .map((range) => ({
      end: Math.min(end, range.end) - start,
      start: Math.max(start, range.start) - start,
    }))
    .filter((range) => range.start < range.end);

  return renderStyledLine(
    {
      ...line,
      runs,
      text: line.text.slice(start, end),
    },
    shiftedRanges,
  );
}
