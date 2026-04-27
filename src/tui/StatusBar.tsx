import React from 'react';
import { Box, Text } from 'ink';

type StatusBarProps = {
  activity?: string | undefined;
  activeHitOrdinal?: number | undefined;
  currentLine: number;
  displayMode: 'preview' | 'text';
  filename: string;
  hitCount: number;
  page: number;
  pageCount: number;
  searchActive: boolean;
  totalLines: number;
};

export function StatusBar({
  activity,
  activeHitOrdinal,
  currentLine,
  displayMode,
  filename,
  hitCount,
  page,
  pageCount,
  searchActive,
  totalLines,
}: StatusBarProps): React.JSX.Element {
  const segments: string[] = [filename];

  if (displayMode === 'text') {
    segments.push(
      `line ${Math.min(currentLine + 1, totalLines)}/${totalLines}`,
    );
  }

  segments.push(`page ${page}/${pageCount}`);
  segments.push(displayMode);

  if (searchActive) {
    const hitStatus =
      activeHitOrdinal === undefined || hitCount === 0
        ? `${hitCount} hit${hitCount === 1 ? '' : 's'}`
        : `hit ${activeHitOrdinal}/${hitCount}`;

    segments.push(hitStatus);
  } else {
    segments.push('press ? for help');
  }

  if (activity !== undefined) {
    segments.push(activity);
  }

  return (
    <Box paddingX={1}>
      <Text inverse>{segments.join(' · ')}</Text>
    </Box>
  );
}
