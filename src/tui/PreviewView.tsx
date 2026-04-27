import React, { useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

import type { RasterPage } from '../core/raster.js';
import type { GraphicsCapability } from './graphics.js';

type PreviewViewProps = {
  capability: GraphicsCapability;
  isRendering?: boolean;
  pageNumber: number;
  pages: RasterPage[];
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
  const resetCursor = '[H';
  const payload = page.png.toString('base64');
  const displayWidth = page.displayWidth ?? page.width;
  const displayHeight = page.displayHeight ?? page.height;

  if (capability === 'kitty') {
    const placement =
      page.displayColumns === undefined || page.displayRows === undefined
        ? ''
        : `,c=${page.displayColumns},r=${page.displayRows}`;

    const deleteExistingImage = clear ? '_Ga=d,d=A\\' : '';

    return `${resetCursor}${deleteExistingImage}_Ga=T,f=100${placement};${payload}\\`;
  }

  return `${resetCursor}]1337;File=inline=1;width=${displayWidth}px;height=${displayHeight}px:${payload}`;
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
  const lastRenderedPage = useRef<RasterPage | null>(null);

  // Re-emit on every render. Standard log-update writes eraseLines+content
  // each render which wipes the image cells, so we need to redraw after every
  // ink commit. DECSC/DECRC keeps ink's cursor expectations intact, and the
  // delayed follow-up catches ink's throttled trailing render that fires after
  // this effect.
  useEffect(() => {
    if (currentPage === undefined) {
      return;
    }

    const clear = lastRenderedPage.current !== currentPage;
    const escape = renderInlinePreviewImage(currentPage, capability, { clear });

    if (escape === null) {
      return;
    }

    const wrapped = `7${escape}8`;
    stdout.write(wrapped);
    lastRenderedPage.current = currentPage;

    const followUp = setTimeout(() => {
      stdout.write(wrapped);
    }, 60);
    return () => clearTimeout(followUp);
  });

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

  return <Text>{'\n'.repeat(Math.max(0, reservedRows))}</Text>;
}
