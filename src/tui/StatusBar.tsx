import React from 'react';
import { Box, Text } from 'ink';

type StatusBarProps = {
  activity?: string | undefined;
  activeHitOrdinal?: number | undefined;
  currentLine: number;
  displayMode: 'preview' | 'text';
  filename: string;
  hitCount: number;
  mode: 'help' | 'links' | 'normal' | 'page' | 'search';
  page: number;
  pageCount: number;
  totalLines: number;
};

export function StatusBar({
  activity,
  activeHitOrdinal,
  currentLine,
  displayMode,
  filename,
  hitCount,
  mode,
  page,
  pageCount,
  totalLines,
}: StatusBarProps): React.JSX.Element {
  const hitStatus =
    activeHitOrdinal === undefined || hitCount === 0
      ? `${hitCount} hit${hitCount === 1 ? '' : 's'}`
      : `hit ${activeHitOrdinal}/${hitCount}`;

  return (
    <Box paddingX={1}>
      <Text inverse>
        {filename} · line {Math.min(currentLine + 1, totalLines)}/{totalLines} ·
        page {page}/{pageCount} · {displayMode} · {mode} · {hitStatus}
        {activity === undefined ? '' : ` · ${activity}`}
      </Text>
    </Box>
  );
}
