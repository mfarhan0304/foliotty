import React, { useEffect, useReducer, useRef } from 'react';
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
  originColumn?: number;
};

export function clearInlinePreviewImage(
  capability: GraphicsCapability,
): string | null {
  if (capability === 'kitty') {
    return '\x1b_Ga=d,d=A\x1b\\';
  }

  if (capability === 'iterm') {
    return '\x1b[2J\x1b[H';
  }

  return null;
}

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
  const originColumn = options.originColumn ?? 1;
  const resetCursor = `[1;${originColumn}H`;
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

  // iTerm OSC 1337: a bare number means N character cells. Sizing in cells
  // (instead of px) makes the image footprint match displayColumns/displayRows
  // exactly regardless of the terminal's actual cell pixel size, which keeps
  // centering math accurate. The PNG is rendered at higher pixel density
  // (renderWidth = 2x displayWidth) so iTerm has resolution to scale down.
  const itermColumns =
    page.displayColumns ?? Math.max(1, Math.round(displayWidth / 10));
  const itermRows =
    page.displayRows ?? Math.max(1, Math.round(displayHeight / 24));

  return `${resetCursor}]1337;File=inline=1;width=${itermColumns};height=${itermRows}:${payload}`;
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
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  // When transitioning from a rendered page to the placeholder (loading or
  // unrendered), the previous image still occupies the cells because it was
  // emitted out of band via stdout.write — ink's diff doesn't know about it.
  // Wipe it explicitly and force one more ink render so the centered loader
  // text is repainted on top of the cleared cells.
  useEffect(() => {
    if (currentPage !== undefined || lastRenderedPage.current === null) {
      return;
    }

    const escape = clearInlinePreviewImage(capability);
    if (escape === null) {
      return;
    }

    stdout.write(escape);
    lastRenderedPage.current = null;
    const timer = setTimeout(forceRender, 0);
    return () => clearTimeout(timer);
  });

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
    const terminalColumns = stdout.columns ?? 80;
    const pageColumns = currentPage.displayColumns ?? terminalColumns;
    const originColumn = Math.max(
      1,
      Math.floor((terminalColumns - pageColumns) / 2) + 1,
    );
    const escape = renderInlinePreviewImage(currentPage, capability, {
      clear,
      originColumn,
    });

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
