import React from 'react';
import { Box, Text } from 'ink';

type StatusBarProps = {
  currentLine: number;
  filename: string;
  hitCount: number;
  mode: 'help' | 'normal' | 'search';
  page: number;
  pageCount: number;
  totalLines: number;
};

export function StatusBar({
  currentLine,
  filename,
  hitCount,
  mode,
  page,
  pageCount,
  totalLines,
}: StatusBarProps): React.JSX.Element {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>
        {filename} · line {Math.min(currentLine + 1, totalLines)}/{totalLines} ·
        page {page}/{pageCount} · {mode} · {hitCount} hit
        {hitCount === 1 ? '' : 's'}
      </Text>
    </Box>
  );
}
