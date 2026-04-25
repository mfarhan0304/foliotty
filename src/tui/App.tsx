import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import type { PdfLink } from '../core/pdf-service.js';
import { createSearchIndex, searchIndexedLines } from '../core/search.js';
import type { StyledLine } from '../core/structure.js';
import { HelpOverlay } from './HelpOverlay.js';
import { LinkOverlay } from './LinkOverlay.js';
import {
  countWrappedRows,
  lineIndexAtRowOffset,
  rowOffsetForLine,
} from './layout.js';
import { openUrl as defaultOpenUrl } from './open-url.js';
import type { OpenUrl } from './open-url.js';
import { ResumeView } from './ResumeView.js';
import { SearchPrompt } from './SearchPrompt.js';
import { StatusBar } from './StatusBar.js';

type PageBundle = {
  lines: StyledLine[];
  links: PdfLink[];
};

type AppProps = {
  filename: string;
  openUrl?: OpenUrl;
  pages: PageBundle[];
};

type Mode = 'help' | 'links' | 'normal' | 'page' | 'search';

type DisplayPage = {
  lines: StyledLine[];
};

type FlattenedDocument = {
  displayPages: DisplayPage[];
  lines: StyledLine[];
  pageStarts: number[];
};

function toDisplayPages(pages: PageBundle[]): DisplayPage[] {
  return pages.map((page) => {
    if (page.links.length === 0) {
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
        ...page.links.map((link) => ({
          kind: 'bullet' as const,
          runs: [
            {
              bold: false,
              italic: false,
              text: `  • ${link.text} -> ${link.url}`,
            },
          ],
          text: `  • ${link.text} -> ${link.url}`,
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
  openUrl = defaultOpenUrl,
  pages,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { displayPages, lines, pageStarts } = useMemo(
    () => flattenPages(pages),
    [pages],
  );
  const contentWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const visibleRowCount = Math.max(1, (stdout.rows ?? 24) - 4);
  const [mode, setMode] = useState<Mode>('normal');
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pageScrollOffsets, setPageScrollOffsets] = useState<number[]>(
    displayPages.map(() => 0),
  );
  const [searchValue, setSearchValue] = useState('');
  const [pageValue, setPageValue] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(0);
  const [awaitingSecondG, setAwaitingSecondG] = useState(false);

  const searchIndex = useMemo(() => createSearchIndex(lines), [lines]);
  const hits = useMemo(
    () => searchIndexedLines(searchIndex, activeQuery),
    [activeQuery, searchIndex],
  );
  const currentHit = hits[activeHitIndex] ?? null;
  const currentHitLineIndex = currentHit?.lineIndex ?? null;
  const currentPage = displayPages[currentPageIndex] ?? { lines: [] };
  const currentPageLinks = pages[currentPageIndex]?.links ?? [];
  const currentPageStart = pageStarts[currentPageIndex] ?? 0;
  const currentPageScrollOffset = pageScrollOffsets[currentPageIndex] ?? 0;
  const currentPageNumber = currentPageIndex + 1;
  const pageCount = displayPages.length;
  const currentHitPage =
    currentHitLineIndex === null
      ? null
      : pageForLine(currentHitLineIndex, pageStarts);
  const currentHitLocalLineIndex =
    currentHitPage === currentPageNumber && currentHitLineIndex !== null
      ? currentHitLineIndex - currentPageStart
      : null;
  const currentLine =
    currentHitLocalLineIndex ??
    lineIndexAtRowOffset(
      currentPage.lines,
      currentPageScrollOffset,
      contentWidth,
    );

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

  function submitSearch(value: string): void {
    setActiveQuery(value);
    setActiveHitIndex(0);
    setMode('normal');
  }

  function submitPageJump(value: string): void {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed)) {
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
    setSelectedLinkIndex((current) =>
      clamp(current, 0, Math.max(0, currentPageLinks.length - 1)),
    );
  }, [currentPageLinks.length]);

  useEffect(() => {
    if (currentHitLineIndex !== null) {
      const pageIndex = pageForLine(currentHitLineIndex, pageStarts) - 1;
      const pageStart = pageStarts[pageIndex] ?? 0;
      const targetScroll = rowOffsetForLine(
        displayPages[pageIndex]?.lines ?? [],
        currentHitLineIndex - pageStart,
        contentWidth,
      );

      if (currentPageIndex !== pageIndex) {
        moveToPage(pageIndex);
      }

      if ((pageScrollOffsets[pageIndex] ?? 0) !== targetScroll) {
        updatePageScroll(pageIndex, targetScroll);
      }
    }
  }, [
    contentWidth,
    currentHitLineIndex,
    currentPageIndex,
    displayPages,
    pageScrollOffsets,
    pageStarts,
  ]);

  const currentPageHitRanges = useMemo(
    () =>
      new Map(
        hits
          .filter(
            (hit) =>
              pageForLine(hit.lineIndex, pageStarts) === currentPageNumber,
          )
          .map(
            (hit) => [hit.lineIndex - currentPageStart, hit.ranges] as const,
          ),
      ),
    [currentPageNumber, currentPageStart, hits, pageStarts],
  );

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
        setAwaitingSecondG(false);
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

    if (input === 'q') {
      exit();
      return;
    }

    if (input === '?') {
      setMode('help');
      setAwaitingSecondG(false);
      return;
    }

    if (input === '/') {
      setSearchValue(activeQuery);
      setMode('search');
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'l') {
      setSelectedLinkIndex(0);
      setMode('links');
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'p') {
      setPageValue('');
      setMode('page');
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'j') {
      updatePageScroll(currentPageIndex, currentPageScrollOffset - 1);
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'k') {
      updatePageScroll(currentPageIndex, currentPageScrollOffset + 1);
      setAwaitingSecondG(false);
      return;
    }

    if (key.ctrl && input === 'd') {
      updatePageScroll(
        currentPageIndex,
        currentPageScrollOffset + Math.floor(visibleRowCount / 2),
      );
      setAwaitingSecondG(false);
      return;
    }

    if (key.ctrl && input === 'u') {
      updatePageScroll(
        currentPageIndex,
        currentPageScrollOffset - Math.floor(visibleRowCount / 2),
      );
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'n' && hits.length > 0) {
      setActiveHitIndex((value) => (value + 1) % hits.length);
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'N' && hits.length > 0) {
      setActiveHitIndex((value) => (value - 1 + hits.length) % hits.length);
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'G') {
      updatePageScroll(currentPageIndex, maxScrollForPage(currentPageIndex));
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'g') {
      if (awaitingSecondG) {
        updatePageScroll(currentPageIndex, 0);
        setAwaitingSecondG(false);
      } else {
        setAwaitingSecondG(true);
      }
      return;
    }

    if (input === 'J') {
      moveToPage(currentPageIndex - 1);
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'K') {
      moveToPage(currentPageIndex + 1);
      setAwaitingSecondG(false);
      return;
    }

    setAwaitingSecondG(false);
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
        ) : (
          <ResumeView
            contentWidth={contentWidth}
            currentHitLineIndex={currentHitLocalLineIndex}
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
          onSubmit={submitSearch}
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
          currentLine={currentLine}
          filename={filename}
          hitCount={hits.length}
          mode={mode}
          page={currentPageNumber}
          pageCount={pageCount}
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
      ) : null}
    </Box>
  );
}
