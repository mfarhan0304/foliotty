import React, { useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

import type { RasterPage } from '../core/raster.js';
import type { GraphicsCapability } from './graphics.js';

type PreviewViewProps = {
  capability: GraphicsCapability;
  isRendering?: boolean;
  pageNumber: number;
  pages: RasterPage[];
  repaintKey?: string;
};

type RenderInlinePreviewImageOptions = {
  clear?: boolean;
};

export function supportsInlinePreview(
  capability: GraphicsCapability,
): capability is 'iterm' | 'kitty' {
  return capability === 'iterm' || capability === 'kitty';
}

export function renderInlinePreviewImage(
  page: RasterPage,
  capability: GraphicsCapability,
  options: RenderInlinePreviewImageOptions = {},
): string | null {
  if (!supportsInlinePreview(capability)) {
    return null;
  }

  const clear = options.clear ?? true;
  const resetCursor = '\u001B[H';
  const resetScreen = clear ? '\u001B[2J\u001B[3J\u001B[H' : resetCursor;
  const payload = page.png.toString('base64');
  const displayWidth = page.displayWidth ?? page.width;
  const displayHeight = page.displayHeight ?? page.height;

  if (capability === 'kitty') {
    const placement =
      page.displayColumns === undefined || page.displayRows === undefined
        ? ''
        : `,c=${page.displayColumns},r=${page.displayRows}`;

    const deleteExistingImage = clear ? '\u001B_Ga=d,d=A\u001B\\' : '';

    return `${resetScreen}${deleteExistingImage}\u001B_Ga=T,f=100${placement};${payload}\u001B\\`;
  }

  return `${resetScreen}\u001B]1337;File=inline=1;width=${displayWidth}px;height=${displayHeight}px:${payload}\u0007`;
}

export function PreviewView({
  capability,
  isRendering = false,
  pageNumber,
  pages,
  repaintKey = '',
}: PreviewViewProps): React.JSX.Element {
  const { stdout } = useStdout();
  const currentPage = pages[0];
  const reservedRows = currentPage?.displayRows ?? 0;
  const lastRenderedPage = useRef<RasterPage | null>(null);

  useEffect(() => {
    if (currentPage === undefined) {
      return;
    }

    const clear = lastRenderedPage.current !== currentPage;
    const escape = renderInlinePreviewImage(currentPage, capability, { clear });

    if (escape === null) {
      return;
    }

    stdout.write(escape);
    lastRenderedPage.current = currentPage;
  }, [capability, currentPage, repaintKey, stdout]);

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
