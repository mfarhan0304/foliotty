import React from 'react';
import { Box, Text } from 'ink';

import type { StyledLine } from '../core/structure.js';
import { wrapTextSegments } from './layout.js';
import { renderStyledLineSlice } from './render.js';

type ActiveHitRange = {
  localLineIndex: number;
  range: { end: number; start: number };
};

type ResumeViewProps = {
  activeHitRange?: ActiveHitRange | null;
  activeLineIndex: number | null;
  contentWidth: number;
  hitRangesByLine: Map<number, Array<{ end: number; start: number }>>;
  lines: StyledLine[];
  scrollOffset: number;
  visibleRowCount: number;
};

type ViewSegment = {
  isFirstRow: boolean;
  lineIndex: number;
  segmentEnd: number;
  segmentStart: number;
};

function getVisibleSegments(
  lines: StyledLine[],
  contentWidth: number,
  scrollOffset: number,
  visibleRowCount: number,
): ViewSegment[] {
  const segments: ViewSegment[] = [];
  const availableWidth = Math.max(1, contentWidth - 2);
  let skippedRows = 0;

  for (const [lineIndex, line] of lines.entries()) {
    const wrapped = wrapTextSegments(line.text, availableWidth);

    for (const [rowIndex, segment] of wrapped.entries()) {
      if (skippedRows < scrollOffset) {
        skippedRows += 1;
        continue;
      }

      if (segments.length >= visibleRowCount) {
        break;
      }

      segments.push({
        isFirstRow: rowIndex === 0,
        lineIndex,
        segmentEnd: segment.end,
        segmentStart: segment.start,
      });
    }

    if (segments.length >= visibleRowCount) {
      break;
    }
  }

  return segments;
}

export function ResumeView({
  activeHitRange = null,
  activeLineIndex,
  contentWidth,
  hitRangesByLine,
  lines,
  scrollOffset,
  visibleRowCount,
}: ResumeViewProps): React.JSX.Element {
  const segments = getVisibleSegments(
    lines,
    contentWidth,
    scrollOffset,
    visibleRowCount,
  );

  return (
    <Box flexDirection="column">
      {segments.map((segment) => {
        const line = lines[segment.lineIndex];
        // The orange highlight already pinpoints the active match in search
        // mode, so the `>` cursor only renders when no search is active.
        const prefix =
          activeHitRange === null &&
          activeLineIndex === segment.lineIndex &&
          segment.isFirstRow
            ? '> '
            : '  ';
        const activeRange =
          activeHitRange !== null &&
          activeHitRange.localLineIndex === segment.lineIndex
            ? activeHitRange.range
            : null;

        return (
          <Text
            key={`${segment.lineIndex}:${segment.segmentStart}:${segment.segmentEnd}`}
          >
            {prefix}
            {line
              ? renderStyledLineSlice(
                  line,
                  segment.segmentStart,
                  segment.segmentEnd,
                  hitRangesByLine.get(segment.lineIndex) ?? [],
                  activeRange,
                )
              : ''}
          </Text>
        );
      })}
    </Box>
  );
}
