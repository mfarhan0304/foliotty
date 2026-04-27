import React from 'react';
import { Box, Text } from 'ink';

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

    return `\u001B[2J\u001B[3J\u001B[H\u001B_Ga=d,d=A\u001B\\\u001B_Ga=T,f=100${placement};${payload}\u001B\\`;
  }

  return `\u001B[2J\u001B[3J\u001B[H\u001B]1337;File=inline=1;width=${displayWidth}px;height=${displayHeight}px:${payload}\u0007`;
}

export function PreviewView({
  capability,
  isRendering = false,
  pageNumber,
  pages,
}: PreviewViewProps): React.JSX.Element {
  const images = pages
    .map((page) => renderInlinePreviewImage(page, capability))
    .filter((image): image is string => image !== null);

  if (images.length === 0) {
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

  return (
    <Box flexDirection="row">
      {images.map((image, index) => (
        <Box key={index} marginRight={index < images.length - 1 ? 1 : 0}>
          <Text>{image}</Text>
        </Box>
      ))}
    </Box>
  );
}
