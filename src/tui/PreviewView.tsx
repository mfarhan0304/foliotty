import React from 'react';
import { Box, Text } from 'ink';

import type { RasterPage } from '../core/raster.js';
import type { GraphicsCapability } from './graphics.js';

type PreviewViewProps = {
  capability: GraphicsCapability;
  page: RasterPage | undefined;
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

  if (capability === 'kitty') {
    return `\u001B_Ga=T,f=100;${payload}\u001B\\`;
  }

  return `\u001B]1337;File=inline=1;width=auto;height=auto:${payload}\u0007`;
}

export function PreviewView({
  capability,
  page,
}: PreviewViewProps): React.JSX.Element {
  const image = page ? renderInlinePreviewImage(page, capability) : null;

  return (
    <Box flexDirection="column">
      {image ? (
        <Text>{image}</Text>
      ) : (
        <Text dimColor>
          Raster preview is unavailable in this terminal. Press t for text mode.
        </Text>
      )}
    </Box>
  );
}
