import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import type { PdfLink, TextItem } from '../core/pdf-service.js';
import type { RasterPage } from '../core/raster.js';
import {
  createSearchIndex,
  searchIndexedLines,
  searchTextItems,
} from '../core/search.js';
import type { PageSearchHit } from '../core/search.js';
import type { StyledLine } from '../core/structure.js';
import { HelpOverlay } from './HelpOverlay.js';
import { LinkOverlay } from './LinkOverlay.js';
import type { GraphicsCapability } from './graphics.js';
import { countWrappedRows, rowOffsetForLine } from './layout.js';
import { openUrl as defaultOpenUrl } from './open-url.js';
import type { OpenUrl } from './open-url.js';
import { PreviewView, supportsInlinePreview } from './PreviewView.js';
import { ResumeView } from './ResumeView.js';
import { SearchPrompt } from './SearchPrompt.js';
import { StatusBar } from './StatusBar.js';

type PageBundle = {
  lines: StyledLine[];
  links: PdfLink[];
};

type AppProps = {
  filename: string;
  graphicsCapability?: GraphicsCapability;
  openUrl?: OpenUrl;
  pages: PageBundle[];
  previewPages?: RasterPage[];
  renderHighlightedPreviewPage?: (
    pageIndex: number,
    query: string,
    activeHitIndex: number,
  ) => Promise<RasterPage>;
  renderPreviewPage?: (pageIndex: number) => Promise<RasterPage>;
  textPages?: TextItem[][];
};

type DisplayMode = 'preview' | 'text';
type Mode = 'help' | 'links' | 'normal' | 'page' | 'search';

type DisplayPage = {
  lines: StyledLine[];
};

const EMPTY_RASTER_PAGES: RasterPage[] = [];
const EMPTY_TEXT_PAGES: TextItem[][] = [];
const MAX_CACHED_PREVIEW_PAGES = 8;

type FlattenedDocument = {
  displayPages: DisplayPage[];
  lines: StyledLine[];
  pageStarts: number[];
};

function dedupeLinksByUrl(links: PdfLink[]): PdfLink[] {
  const seen = new Set<string>();
  const result: PdfLink[] = [];

  // PDFs hyphenate long URLs across visual lines, which makes pdfjs return
  // one annotation per fragment ("…erm2-" + "nwe9") all pointing at the same
  // destination. Keep the first occurrence so the user sees one link per URL.
  for (const link of links) {
    if (seen.has(link.url)) {
      continue;
    }

    seen.add(link.url);
    result.push(link);
  }

  return result;
}

function toDisplayPages(pages: PageBundle[]): DisplayPage[] {
  return pages.map((page) => {
    const uniqueLinks = dedupeLinksByUrl(page.links);

    if (uniqueLinks.length === 0) {
      return { lines: page.lines };
    }

    return {
      lines: [
        ...page.lines,
        { kind: 'blank', runs: [], text: '' },
        {
          kind: 'h2',
          runs: [{ bold: true, italic: false, text: 'Links' }],
          text: 'Links',
        },
        ...uniqueLinks.map((link) => ({
          kind: 'bullet' as const,
          runs: [
            {
              bold: false,
              italic: false,
              text: `  • ${link.url}`,
            },
          ],
          text: `  • ${link.url}`,
        })),
      ],
    };
  });
}

function flattenPages(pages: PageBundle[]): FlattenedDocument {
  const displayPages = toDisplayPages(pages);
  const lines: StyledLine[] = [];
  const pageStarts: number[] = [];

  for (const [index, page] of displayPages.entries()) {
    pageStarts.push(lines.length);
    lines.push(...page.lines);

    if (index < displayPages.length - 1) {
      lines.push({ kind: 'blank', runs: [], text: '' });
    }
  }

  return { displayPages, lines, pageStarts };
}

function pageForLine(lineIndex: number, pageStarts: number[]): number {
  let page = 1;

  for (const [index, start] of pageStarts.entries()) {
    if (lineIndex >= start) {
      page = index + 1;
    } else {
      break;
    }
  }

  return page;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizePageValue(value: string): string {
  return value.replaceAll(/[^\d]/gu, '');
}

export function App({
  filename,
  graphicsCapability = 'none',
  openUrl = defaultOpenUrl,
  pages,
  previewPages = EMPTY_RASTER_PAGES,
  renderHighlightedPreviewPage,
  renderPreviewPage,
  textPages = EMPTY_TEXT_PAGES,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { displayPages, lines, pageStarts } = useMemo(
    () => flattenPages(pages),
    [pages],
  );
  const contentWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const visibleRowCount = Math.max(1, (stdout.rows ?? 24) - 4);
  const [highlightedPreviewPages, setHighlightedPreviewPages] =
    useState<RasterPage[]>(previewPages);
  const renderedPreviewPageIndexesRef = useRef<Set<number>>(
    new Set(previewPages.map((_, index) => index)),
  );
  const previewPageAccessOrder = useRef<number[]>(
    previewPages.map((_, index) => index),
  );
  const previewRenderPromises = useRef<Map<number, Promise<void>>>(new Map());
  const [renderingPreviewPageIndex, setRenderingPreviewPageIndex] = useState<
    number | null
  >(null);
  const activePreviewPages =
    highlightedPreviewPages.length > 0 ? highlightedPreviewPages : previewPages;
  const previewAvailable =
    supportsInlinePreview(graphicsCapability) &&
    (activePreviewPages.length > 0 || renderPreviewPage !== undefined);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    previewAvailable ? 'preview' : 'text',
  );
  const [mode, setMode] = useState<Mode>('normal');
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pageScrollOffsets, setPageScrollOffsets] = useState<number[]>(
    displayPages.map(() => 0),
  );
  const [pageCursorLines, setPageCursorLines] = useState<number[]>(
    displayPages.map(() => 0),
  );
  const [searchValue, setSearchValue] = useState('');
  const [pageValue, setPageValue] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const [activePreviewHitIndex, setActivePreviewHitIndex] = useState(0);
  const [previewHits, setPreviewHits] = useState<PageSearchHit[]>([]);
  const [highlightedPreviewPageIndexes, setHighlightedPreviewPageIndexes] =
    useState<Set<number>>(() => new Set());
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(0);

  const searchIndex = useMemo(() => createSearchIndex(lines), [lines]);
  const hits = useMemo(
    () => searchIndexedLines(searchIndex, activeQuery),
    [activeQuery, searchIndex],
  );
  const currentHit = hits[activeHitIndex] ?? null;
  const currentHitLineIndex = currentHit?.lineIndex ?? null;
  const currentPage = displayPages[currentPageIndex] ?? { lines: [] };
  const currentPageLinks = useMemo(
    () => dedupeLinksByUrl(pages[currentPageIndex]?.links ?? []),
    [currentPageIndex, pages],
  );
  const currentPreviewPage = activePreviewPages[currentPageIndex];
  const currentPreviewPages =
    currentPreviewPage === undefined ? [] : [currentPreviewPage];
  const currentPageStart = pageStarts[currentPageIndex] ?? 0;
  const currentPageScrollOffset = pageScrollOffsets[currentPageIndex] ?? 0;
  const currentPageCursorLine = pageCursorLines[currentPageIndex] ?? 0;
  const currentPageNumber = currentPageIndex + 1;
  const pageCount = displayPages.length;
  const currentLine = currentPageCursorLine;
  const statusHitCount =
    displayMode === 'preview' && previewHits.length > 0
      ? previewHits.length
      : hits.length;
  const activeHitOrdinal =
    statusHitCount === 0
      ? undefined
      : displayMode === 'preview' && previewHits.length > 0
        ? activePreviewHitIndex + 1
        : activeHitIndex + 1;
  const previewActivity =
    displayMode === 'preview' && renderingPreviewPageIndex !== null
      ? `rendering page ${renderingPreviewPageIndex + 1}`
      : undefined;
  function maxScrollForPage(pageIndex: number): number {
    return Math.max(
      0,
      countWrappedRows(displayPages[pageIndex]?.lines ?? [], contentWidth) -
        visibleRowCount,
    );
  }

  function updatePageScroll(pageIndex: number, nextValue: number): void {
    setPageScrollOffsets((offsets) => {
      const target = clamp(nextValue, 0, maxScrollForPage(pageIndex));

      if ((offsets[pageIndex] ?? 0) === target) {
        return offsets;
      }

      return offsets.map((offset, index) =>
        index === pageIndex ? target : offset,
      );
    });
  }

  function lastLineForPage(pageIndex: number): number {
    return Math.max(0, (displayPages[pageIndex]?.lines.length ?? 1) - 1);
  }

  function updatePageCursor(pageIndex: number, nextLine: number): void {
    setPageCursorLines((cursors) => {
      const target = clamp(nextLine, 0, lastLineForPage(pageIndex));

      if ((cursors[pageIndex] ?? 0) === target) {
        return cursors;
      }

      return cursors.map((cursor, index) =>
        index === pageIndex ? target : cursor,
      );
    });
  }

  function moveToPage(pageIndex: number): void {
    setCurrentPageIndex((current) => {
      const next = clamp(pageIndex, 0, Math.max(0, pageCount - 1));
      return current === next ? current : next;
    });
  }

  function moveSelectedLink(delta: number): void {
    setSelectedLinkIndex((current) => {
      if (currentPageLinks.length === 0) {
        return 0;
      }

      return clamp(current + delta, 0, currentPageLinks.length - 1);
    });
  }

  function markPreviewPageAccessed(pageIndex: number): void {
    previewPageAccessOrder.current = [
      ...previewPageAccessOrder.current.filter((index) => index !== pageIndex),
      pageIndex,
    ];
  }

  function prunePreviewPageCache(
    pagesToPrune: RasterPage[],
    extraProtectedPageIndexes: Set<number> = new Set(),
  ): RasterPage[] {
    const protectedPageIndexes = new Set([
      currentPageIndex,
      currentPageIndex - 1,
      currentPageIndex + 1,
      ...highlightedPreviewPageIndexes,
      ...extraProtectedPageIndexes,
    ]);
    const cachedPageIndexes = new Set(
      pagesToPrune
        .map((page, index) => (page === undefined ? null : index))
        .filter((index): index is number => index !== null),
    );

    while (cachedPageIndexes.size > MAX_CACHED_PREVIEW_PAGES) {
      const evictablePageIndex = previewPageAccessOrder.current.find(
        (pageIndex) =>
          cachedPageIndexes.has(pageIndex) &&
          !protectedPageIndexes.has(pageIndex),
      );

      if (evictablePageIndex === undefined) {
        break;
      }

      delete pagesToPrune[evictablePageIndex];
      cachedPageIndexes.delete(evictablePageIndex);
      renderedPreviewPageIndexesRef.current.delete(evictablePageIndex);
      previewPageAccessOrder.current = previewPageAccessOrder.current.filter(
        (pageIndex) => pageIndex !== evictablePageIndex,
      );
    }

    return pagesToPrune;
  }

  function cachePreviewPage(pageIndex: number, page: RasterPage): void {
    setHighlightedPreviewPages((currentPages) => {
      const nextPages =
        currentPages.length > 0 ? [...currentPages] : [...previewPages];
      nextPages[pageIndex] = page;
      markPreviewPageAccessed(pageIndex);
      return prunePreviewPageCache(nextPages, new Set([pageIndex]));
    });
    renderedPreviewPageIndexesRef.current = new Set([
      ...renderedPreviewPageIndexesRef.current,
      pageIndex,
    ]);
  }

  async function renderPreviewPageIntoCache(
    pageIndex: number,
    showActivity: boolean,
  ): Promise<void> {
    if (
      renderPreviewPage === undefined ||
      pageIndex < 0 ||
      pageIndex >= pageCount ||
      renderedPreviewPageIndexesRef.current.has(pageIndex)
    ) {
      return;
    }

    const pendingRender = previewRenderPromises.current.get(pageIndex);

    if (pendingRender !== undefined) {
      if (showActivity) {
        setRenderingPreviewPageIndex(pageIndex);
        await pendingRender;
        setRenderingPreviewPageIndex((currentIndex) =>
          currentIndex === pageIndex ? null : currentIndex,
        );
      }

      return;
    }

    const renderPromise = renderPreviewPage(pageIndex)
      .then((renderedPage) => cachePreviewPage(pageIndex, renderedPage))
      .finally(() => previewRenderPromises.current.delete(pageIndex));
    previewRenderPromises.current.set(pageIndex, renderPromise);

    if (!showActivity) {
      void renderPromise;
      return;
    }

    setRenderingPreviewPageIndex(pageIndex);

    try {
      await renderPromise;
    } finally {
      setRenderingPreviewPageIndex((currentIndex) =>
        currentIndex === pageIndex ? null : currentIndex,
      );
    }
  }

  async function ensurePreviewPage(pageIndex: number): Promise<void> {
    await renderPreviewPageIntoCache(pageIndex, true);
  }

  function prefetchPreviewPage(pageIndex: number): void {
    void renderPreviewPageIntoCache(pageIndex, false);
  }

  function submitSearch(value: string): void {
    setActiveQuery(value);
    setActiveHitIndex(0);
    setActivePreviewHitIndex(0);
    setPreviewHits([]);
    setMode('normal');
  }

  async function renderPreviewHit(
    hitIndex: number,
    query: string,
    nextPreviewHits: PageSearchHit[] = previewHits,
  ): Promise<void> {
    if (renderHighlightedPreviewPage === undefined) {
      return;
    }

    const hit = nextPreviewHits[hitIndex];

    if (hit === undefined) {
      return;
    }

    moveToPage(hit.pageIndex);

    setRenderingPreviewPageIndex(hit.pageIndex);

    let highlightedPage: RasterPage;

    try {
      highlightedPage = await renderHighlightedPreviewPage(
        hit.pageIndex,
        query,
        hitIndex,
      );
    } finally {
      setRenderingPreviewPageIndex((currentIndex) =>
        currentIndex === hit.pageIndex ? null : currentIndex,
      );
    }

    setHighlightedPreviewPages((currentPages) => {
      const nextPages =
        currentPages.length > 0 ? [...currentPages] : [...previewPages];
      nextPages[hit.pageIndex] = highlightedPage;
      markPreviewPageAccessed(hit.pageIndex);
      return prunePreviewPageCache(nextPages, new Set([hit.pageIndex]));
    });
    renderedPreviewPageIndexesRef.current = new Set([
      ...renderedPreviewPageIndexesRef.current,
      hit.pageIndex,
    ]);
    setHighlightedPreviewPageIndexes((currentIndexes) => {
      const nextIndexes = new Set(currentIndexes);
      nextIndexes.add(hit.pageIndex);
      return nextIndexes;
    });
  }

  async function movePreviewHit(delta: number): Promise<void> {
    if (previewHits.length === 0) {
      return;
    }

    const nextIndex =
      (activePreviewHitIndex + delta + previewHits.length) % previewHits.length;
    setActivePreviewHitIndex(nextIndex);
    await renderPreviewHit(nextIndex, activeQuery);
  }

  async function submitPreviewSearch(value: string): Promise<void> {
    setActiveQuery(value);
    setActiveHitIndex(0);
    setActivePreviewHitIndex(0);

    if (renderHighlightedPreviewPage === undefined) {
      setMode('normal');
      return;
    }

    const nextPreviewHits = searchTextItems(textPages, value);
    setPreviewHits(nextPreviewHits);

    if (nextPreviewHits.length === 0) {
      setHighlightedPreviewPages(previewPages);
      setHighlightedPreviewPageIndexes(new Set());
      setMode('normal');
      return;
    }

    setHighlightedPreviewPageIndexes(new Set());
    await renderPreviewHit(0, value, nextPreviewHits);
    setMode('normal');
  }

  function submitPageJump(value: string): void {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed)) {
      setActiveQuery('');
      setActiveHitIndex(0);
      setActivePreviewHitIndex(0);
      setPreviewHits([]);
      moveToPage(parsed - 1);
    }

    setPageValue('');
    setMode('normal');
  }

  useEffect(() => {
    setPageScrollOffsets((offsets) => {
      const nextOffsets = displayPages.map((_, index) =>
        clamp(offsets[index] ?? 0, 0, maxScrollForPage(index)),
      );
      const changed =
        nextOffsets.length !== offsets.length ||
        nextOffsets.some((value, index) => value !== offsets[index]);

      return changed ? nextOffsets : offsets;
    });
  }, [contentWidth, displayPages, visibleRowCount]);

  useEffect(() => {
    if (!previewAvailable && displayMode === 'preview') {
      setDisplayMode('text');
    }
  }, [displayMode, previewAvailable]);

  useEffect(() => {
    const initialRenderedPageIndexes = new Set(
      previewPages.map((_, index) => index),
    );
    setHighlightedPreviewPages(previewPages);
    renderedPreviewPageIndexesRef.current = initialRenderedPageIndexes;
    previewPageAccessOrder.current = previewPages.map((_, index) => index);
    previewRenderPromises.current.clear();
    setHighlightedPreviewPageIndexes(new Set());
    setActivePreviewHitIndex(0);
    setRenderingPreviewPageIndex(null);
    setPreviewHits([]);
  }, [previewPages]);

  useEffect(() => {
    if (displayMode === 'preview') {
      void ensurePreviewPage(currentPageIndex);
      prefetchPreviewPage(currentPageIndex + 1);
      prefetchPreviewPage(currentPageIndex - 1);
    }
  }, [currentPageIndex, displayMode]);

  useEffect(() => {
    setSelectedLinkIndex((current) =>
      clamp(current, 0, Math.max(0, currentPageLinks.length - 1)),
    );
  }, [currentPageLinks.length]);

  useEffect(() => {
    if (displayMode === 'preview') {
      return;
    }

    if (currentHitLineIndex !== null) {
      const pageIndex = pageForLine(currentHitLineIndex, pageStarts) - 1;
      const pageStart = pageStarts[pageIndex] ?? 0;
      const localLine = currentHitLineIndex - pageStart;

      if (currentPageIndex !== pageIndex) {
        moveToPage(pageIndex);
      }

      // Move the cursor to the active hit; the cursor-driven scroll effect
      // below will scroll the viewport to keep the cursor visible.
      updatePageCursor(pageIndex, localLine);
    }
  }, [
    contentWidth,
    currentHitLineIndex,
    displayMode,
    displayPages,
    pageStarts,
  ]);

  // Keep the cursor in the visible viewport: if it scrolls off the top, pull
  // scroll up; if it scrolls past the bottom, pull scroll down. Only fires when
  // the cursor or layout actually changes — the user's manual scroll (which we
  // no longer drive directly via j/k) won't fight this loop because j/k now
  // updates the cursor and lets this effect adjust scroll afterward.
  useEffect(() => {
    if (displayMode !== 'text') {
      return;
    }

    const lines = displayPages[currentPageIndex]?.lines ?? [];
    const cursorRow = rowOffsetForLine(
      lines,
      currentPageCursorLine,
      contentWidth,
    );
    const maxScroll = maxScrollForPage(currentPageIndex);
    const currentScroll = pageScrollOffsets[currentPageIndex] ?? 0;

    let nextScroll = currentScroll;

    if (cursorRow < currentScroll) {
      nextScroll = cursorRow;
    } else if (cursorRow >= currentScroll + visibleRowCount) {
      nextScroll = cursorRow - visibleRowCount + 1;
    }

    nextScroll = clamp(nextScroll, 0, maxScroll);

    if (nextScroll !== currentScroll) {
      updatePageScroll(currentPageIndex, nextScroll);
    }
  }, [
    contentWidth,
    currentPageCursorLine,
    currentPageIndex,
    displayMode,
    displayPages,
    visibleRowCount,
  ]);

  const currentPageHitRanges = useMemo(() => {
    const result = new Map<number, Array<{ end: number; start: number }>>();

    for (const hit of hits) {
      if (pageForLine(hit.lineIndex, pageStarts) !== currentPageNumber) {
        continue;
      }

      const localLine = hit.lineIndex - currentPageStart;
      const existing = result.get(localLine);

      if (existing === undefined) {
        result.set(localLine, [hit.range]);
      } else {
        existing.push(hit.range);
      }
    }

    return result;
  }, [currentPageNumber, currentPageStart, hits, pageStarts]);

  const currentActiveHitRange = useMemo(() => {
    if (currentHit === null) {
      return null;
    }

    if (pageForLine(currentHit.lineIndex, pageStarts) !== currentPageNumber) {
      return null;
    }

    return {
      localLineIndex: currentHit.lineIndex - currentPageStart,
      range: currentHit.range,
    };
  }, [currentHit, currentPageNumber, currentPageStart, pageStarts]);

  useInput((input, key) => {
    if (mode === 'search') {
      if (key.escape) {
        setMode('normal');
        setSearchValue(activeQuery);
        return;
      }

      return;
    }

    if (mode === 'page') {
      if (key.escape) {
        setMode('normal');
        setPageValue('');
      }

      return;
    }

    if (mode === 'help') {
      if (key.escape || input === '?') {
        setMode('normal');
      }
      return;
    }

    if (mode === 'links') {
      if (key.escape || input === 'l') {
        setMode('normal');
        return;
      }

      if (input === 'j') {
        moveSelectedLink(-1);
        return;
      }

      if (input === 'k') {
        moveSelectedLink(1);
        return;
      }

      if (key.return) {
        const selectedLink = currentPageLinks[selectedLinkIndex];

        if (selectedLink !== undefined) {
          openUrl(selectedLink.url);
        }

        return;
      }

      return;
    }

    if (key.escape || input === 'q') {
      exit();
      return;
    }

    if (input === '?') {
      setMode('help');
      return;
    }

    if (input === '/') {
      setSearchValue(activeQuery);
      setMode('search');
      return;
    }

    if (input === 'l') {
      setSelectedLinkIndex(0);
      setMode('links');
      return;
    }

    if (input === 'p') {
      setPageValue('');
      setMode('page');
      return;
    }

    if (input === 't') {
      setDisplayMode((current) =>
        current === 'preview' || !previewAvailable ? 'text' : 'preview',
      );
      return;
    }

    if (input === 'j') {
      if (currentPageCursorLine > 0) {
        updatePageCursor(currentPageIndex, currentPageCursorLine - 1);
      } else if (currentPageIndex > 0) {
        // At the top of this page — flow into the previous page's last line.
        const previousPageIndex = currentPageIndex - 1;
        moveToPage(previousPageIndex);
        updatePageCursor(previousPageIndex, lastLineForPage(previousPageIndex));
      }
      return;
    }

    if (input === 'k') {
      const lastLine = lastLineForPage(currentPageIndex);

      if (currentPageCursorLine < lastLine) {
        updatePageCursor(currentPageIndex, currentPageCursorLine + 1);
      } else if (currentPageIndex < pageCount - 1) {
        // At the bottom of this page — flow into the next page's first line.
        const nextPageIndex = currentPageIndex + 1;
        moveToPage(nextPageIndex);
        updatePageCursor(nextPageIndex, 0);
      }
      return;
    }

    if (input === 'n' && displayMode === 'preview' && previewHits.length > 0) {
      void movePreviewHit(1);
      return;
    }

    if (input === 'N' && displayMode === 'preview' && previewHits.length > 0) {
      void movePreviewHit(-1);
      return;
    }

    if (input === 'n' && hits.length > 0) {
      setActiveHitIndex((value) => (value + 1) % hits.length);
      return;
    }

    if (input === 'N' && hits.length > 0) {
      setActiveHitIndex((value) => (value - 1 + hits.length) % hits.length);
      return;
    }

    if (input === 'J') {
      moveToPage(currentPageIndex - 1);
      return;
    }

    if (input === 'K') {
      moveToPage(currentPageIndex + 1);
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {mode === 'help' ? (
          <HelpOverlay />
        ) : mode === 'links' ? (
          <LinkOverlay
            links={currentPageLinks}
            selectedIndex={selectedLinkIndex}
          />
        ) : displayMode === 'preview' ? (
          <PreviewView
            capability={graphicsCapability}
            isRendering={renderingPreviewPageIndex === currentPageIndex}
            pageNumber={currentPageNumber}
            pages={currentPreviewPages}
          />
        ) : (
          <ResumeView
            activeHitRange={currentActiveHitRange}
            activeLineIndex={currentLine}
            contentWidth={contentWidth}
            hitRangesByLine={currentPageHitRanges}
            lines={currentPage.lines}
            scrollOffset={currentPageScrollOffset}
            visibleRowCount={visibleRowCount}
          />
        )}
      </Box>
      {mode === 'search' ? (
        <SearchPrompt
          value={searchValue}
          onChange={setSearchValue}
          onSubmit={(value) => {
            if (displayMode === 'preview') {
              void submitPreviewSearch(value);
              return;
            }

            submitSearch(value);
          }}
        />
      ) : mode === 'page' ? (
        <SearchPrompt
          label=":"
          value={pageValue}
          onChange={(value) => setPageValue(sanitizePageValue(value))}
          onSubmit={submitPageJump}
        />
      ) : (
        <StatusBar
          activity={previewActivity}
          activeHitOrdinal={activeHitOrdinal}
          currentLine={currentLine}
          displayMode={displayMode}
          filename={filename}
          hitCount={statusHitCount}
          page={currentPageNumber}
          pageCount={pageCount}
          searchActive={activeQuery.length > 0}
          totalLines={currentPage.lines.length}
        />
      )}
      {mode === 'search' ? (
        <Box paddingX={1}>
          <Text dimColor>Enter submit · Esc cancel</Text>
        </Box>
      ) : mode === 'page' ? (
        <Box paddingX={1}>
          <Text dimColor>
            Enter jump to page · Esc cancel · range 1-{pageCount}
          </Text>
        </Box>
      ) : mode === 'links' ? (
        <Box paddingX={1}>
          <Text dimColor>j/k select · Enter open · Esc cancel</Text>
        </Box>
      ) : (
        <Box paddingX={1}>
          <Text> </Text>
        </Box>
      )}
    </Box>
  );
}
