import React, { useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';

import type { RasterPage } from '../core/raster.js';
import type { GraphicsCapability } from './graphics.js';

type PreviewViewProps = {
  capability: GraphicsCapability;
  isRendering?: boolean;
  pageNumber: number;
  pages: RasterPage[];
};

export function supportsInlinePreview(
  capability: GraphicsCapability,
): capability is 'iterm' | 'kitty' {
  return capability === 'iterm' || capability === 'kitty';
}

export function renderInlinePreviewImage(
  page: RasterPage,
  capability: GraphicsCapability,
): string | null {
  if (!supportsInlinePreview(capability)) {
    return null;
  }

  const payload = page.png.toString('base64');
  const displayWidth = page.displayWidth ?? page.width;
  const displayHeight = page.displayHeight ?? page.height;

  if (capability === 'kitty') {
    const placement =
      page.displayColumns === undefined || page.displayRows === undefined
        ? ''
        : `,c=${page.displayColumns},r=${page.displayRows}`;

    return `[2J[3J[H_Ga=d,d=A\\_Ga=T,f=100${placement};${payload}\\`;
  }

  return `[2J[3J[H]1337;File=inline=1;width=${displayWidth}px;height=${displayHeight}px:${payload}`;
}

export function PreviewView({
  capability,
  isRendering = false,
  pageNumber,
  pages,
}: PreviewViewProps): React.JSX.Element {
  const { stdout } = useStdout();
  const currentPage = pages[0];
  const reservedRows = currentPage?.displayRows ?? 0;

  useEffect(() => {
    if (currentPage === undefined) {
      return;
    }

    const escape = renderInlinePreviewImage(currentPage, capability);

    if (escape === null) {
      return;
    }

    stdout.write(escape);
  }, [capability, currentPage, stdout]);

  if (currentPage === undefined || !supportsInlinePreview(capability)) {
    return (
      <Box alignItems="center" flexGrow={1} justifyContent="center">
        {!supportsInlinePreview(capability) ? (
          <Text dimColor>
            Raster preview is unavailable in this terminal. Press t for text
            mode.
          </Text>
        ) : isRendering ? (
          <Text dimColor>Rendering page {pageNumber}...</Text>
        ) : (
          <Text dimColor>Page {pageNumber} is not rendered yet.</Text>
        )}
      </Box>
    );
  }

  return <Box flexGrow={1} height={reservedRows} />;
}
