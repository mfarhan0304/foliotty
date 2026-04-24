import React from 'react';
import { Box, Text } from 'ink';

import type { StyledLine } from '../core/structure.js';
import { renderStyledLine } from './render.js';

type ResumeViewProps = {
  currentHitLineIndex: number | null;
  hitRangesByLine: Map<number, Array<{ end: number; start: number }>>;
  lines: StyledLine[];
  scrollOffset: number;
  visibleLineCount: number;
};

export function ResumeView({
  currentHitLineIndex,
  hitRangesByLine,
  lines,
  scrollOffset,
  visibleLineCount,
}: ResumeViewProps): React.JSX.Element {
  const visibleLines = lines.slice(
    scrollOffset,
    Math.min(lines.length, scrollOffset + visibleLineCount),
  );

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => {
        const lineIndex = scrollOffset + index;
        const prefix = currentHitLineIndex === lineIndex ? '> ' : '  ';

        return (
          <Text key={`${lineIndex}:${line.text}`}>
            {prefix}
            {renderStyledLine(line, hitRangesByLine.get(lineIndex) ?? [])}
          </Text>
        );
      })}
    </Box>
  );
}
