import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

import type { PdfLink } from '../core/pdf-service.js';
import { searchStyledLines, type SearchHit } from '../core/search.js';
import type { StyledLine } from '../core/structure.js';
import { HelpOverlay } from './HelpOverlay.js';
import { ResumeView } from './ResumeView.js';
import { SearchPrompt } from './SearchPrompt.js';
import { StatusBar } from './StatusBar.js';

type PageBundle = {
  lines: StyledLine[];
  links: PdfLink[];
};

type AppProps = {
  filename: string;
  pages: PageBundle[];
};

type FlattenedDocument = {
  lines: StyledLine[];
  pageStarts: number[];
};

function flattenPages(pages: PageBundle[]): FlattenedDocument {
  const lines: StyledLine[] = [];
  const pageStarts: number[] = [];

  for (const [index, page] of pages.entries()) {
    pageStarts.push(lines.length);
    lines.push(...page.lines);

    if (page.links.length > 0) {
      lines.push({ kind: 'blank', runs: [], text: '' });
      lines.push({
        kind: 'h2',
        runs: [{ bold: true, italic: false, text: 'Links' }],
        text: 'Links',
      });
      lines.push(
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
      );
    }

    if (index < pages.length - 1) {
      lines.push({ kind: 'blank', runs: [], text: '' });
    }
  }

  return { lines, pageStarts };
}

function hitRangesByLine(hits: SearchHit[]): Map<number, SearchHit['ranges']> {
  return new Map(hits.map((hit) => [hit.lineIndex, hit.ranges]));
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

export function App({ filename, pages }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { lines, pageStarts } = flattenPages(pages);
  const visibleLineCount = Math.max(1, (stdout.rows ?? 24) - 4);
  const [mode, setMode] = useState<'help' | 'normal' | 'search'>('normal');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchValue, setSearchValue] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeHitIndex, setActiveHitIndex] = useState(0);
  const [awaitingSecondG, setAwaitingSecondG] = useState(false);

  const hits = searchStyledLines(lines, activeQuery);
  const currentHit = hits[activeHitIndex] ?? null;
  const currentLine = currentHit?.lineIndex ?? scrollOffset;
  const currentPage = pageForLine(currentLine, pageStarts);

  useEffect(() => {
    if (!stdout.isTTY) {
      return undefined;
    }

    stdout.write('\u001B[?1049h');

    return () => {
      stdout.write('\u001B[?1049l');
    };
  }, [stdout]);

  useEffect(() => {
    if (currentHit) {
      setScrollOffset((existing) =>
        clamp(
          currentHit.lineIndex,
          0,
          Math.max(0, lines.length - visibleLineCount),
        ),
      );
    }
  }, [currentHit, lines.length, visibleLineCount]);

  useInput((input, key) => {
    if (mode === 'search') {
      if (key.escape) {
        setMode('normal');
        setSearchValue(activeQuery);
        return;
      }

      if (key.return) {
        setActiveQuery(searchValue);
        setActiveHitIndex(0);
        setMode('normal');
      }

      return;
    }

    if (mode === 'help') {
      if (key.escape || input === '?') {
        setMode('normal');
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

    if (input === 'j') {
      setScrollOffset((value) =>
        clamp(value + 1, 0, Math.max(0, lines.length - visibleLineCount)),
      );
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'k') {
      setScrollOffset((value) =>
        clamp(value - 1, 0, Math.max(0, lines.length - visibleLineCount)),
      );
      setAwaitingSecondG(false);
      return;
    }

    if (key.ctrl && input === 'd') {
      setScrollOffset((value) =>
        clamp(
          value + Math.floor(visibleLineCount / 2),
          0,
          Math.max(0, lines.length - visibleLineCount),
        ),
      );
      setAwaitingSecondG(false);
      return;
    }

    if (key.ctrl && input === 'u') {
      setScrollOffset((value) =>
        clamp(
          value - Math.floor(visibleLineCount / 2),
          0,
          Math.max(0, lines.length - visibleLineCount),
        ),
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
      setScrollOffset(Math.max(0, lines.length - visibleLineCount));
      setAwaitingSecondG(false);
      return;
    }

    if (input === 'g') {
      if (awaitingSecondG) {
        setScrollOffset(0);
        setAwaitingSecondG(false);
      } else {
        setAwaitingSecondG(true);
      }
      return;
    }

    setAwaitingSecondG(false);
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        {mode === 'help' ? (
          <HelpOverlay />
        ) : (
          <ResumeView
            currentHitLineIndex={currentHit?.lineIndex ?? null}
            hitRangesByLine={hitRangesByLine(hits)}
            lines={lines}
            scrollOffset={scrollOffset}
            visibleLineCount={visibleLineCount}
          />
        )}
      </Box>
      {mode === 'search' ? (
        <SearchPrompt value={searchValue} onChange={setSearchValue} />
      ) : (
        <StatusBar
          currentLine={currentLine}
          filename={filename}
          hitCount={hits.length}
          mode={mode}
          page={currentPage}
          pageCount={pages.length}
          totalLines={lines.length}
        />
      )}
      {mode === 'search' ? (
        <Box paddingX={1}>
          <Text dimColor>Enter submit · Esc cancel</Text>
        </Box>
      ) : null}
    </Box>
  );
}
