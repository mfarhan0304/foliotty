import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { cleanup, render } from 'ink-testing-library';

import type { PdfLink, TextItem } from '../../core/pdf-service.js';
import type { RasterPage } from '../../core/raster.js';
import type { StyledLine } from '../../core/structure.js';
import { App } from '../App.js';

function tick(delay = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function lastChromeFrame(result: { stdout: { frames: string[] } }): string {
  const frames = result.stdout.frames;

  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];

    if (frame === undefined) {
      continue;
    }

    if (
      frame.startsWith('[2J') ||
      frame.includes('_Ga=T') ||
      frame.includes(']1337;File=')
    ) {
      continue;
    }

    return frame;
  }

  return '';
}

function countInlinePreviewFrames(result: { stdout: { frames: string[] } }) {
  return result.stdout.frames.filter(
    (frame) => frame.includes('_Ga=T') || frame.includes(']1337;File='),
  ).length;
}

function createLine(
  text: string,
  kind: StyledLine['kind'] = 'body',
): StyledLine {
  return {
    kind,
    runs: text.length === 0 ? [] : [{ bold: false, italic: false, text }],
    text,
  };
}

function createLink(text: string, url: string): PdfLink {
  return {
    height: 10,
    text,
    url,
    width: 40,
    x: 0,
    y: 0,
  };
}

function createRasterPage(): RasterPage {
  return {
    height: 1,
    pageNumber: 1,
    png: Buffer.from('png'),
    width: 1,
  };
}

function createTextItem(str: string): TextItem {
  return {
    fontName: 'Helvetica',
    fontSize: 10,
    height: 10,
    str,
    width: str.length * 10,
    x: 0,
    y: 0,
  };
}

describe('App', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders resume lines and status information', () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          {
            lines: [
              createLine('Jane Doe', 'h1'),
              createLine('Software Engineer'),
            ],
            links: [createLink('GitHub', 'https://github.com/example')],
          },
        ]}
      />,
    );

    const frame = result.lastFrame() ?? '';

    assert.match(frame, /Jane Doe/);
    assert.match(frame, /Software Engineer/);
    assert.match(frame, /resume\.pdf/);
    assert.match(frame, /page 1\/1/);
    assert.match(frame, /text/);
  });

  test('starts in preview mode when raster pages are available', () => {
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          {
            lines: [createLine('Text Mode')],
            links: [],
          },
        ]}
        previewPages={[createRasterPage()]}
      />,
    );

    const frame = lastChromeFrame(result);
    assert.match(frame, /preview/);
    assert.doesNotMatch(frame, /Text Mode/);
  });

  test('keeps preview on the current raster page', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          { lines: [createLine('Page One')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
          { lines: [createLine('Page Three')], links: [] },
        ]}
        previewPages={[
          { ...createRasterPage(), pageNumber: 1 },
          { ...createRasterPage(), pageNumber: 2 },
          { ...createRasterPage(), pageNumber: 3 },
        ]}
      />,
    );

    assert.match(lastChromeFrame(result), /page 1\/3/);

    result.stdin.write('K');
    await tick(20);

    assert.match(lastChromeFrame(result), /page 2\/3/);
  });

  test('renders preview pages lazily when navigating', async () => {
    const renderedPages: number[] = [];
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          { lines: [createLine('Page One')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
        ]}
        previewPages={[{ ...createRasterPage(), pageNumber: 1 }]}
        renderPreviewPage={async (pageIndex) => {
          renderedPages.push(pageIndex);
          return { ...createRasterPage(), pageNumber: pageIndex + 1 };
        }}
      />,
    );

    result.stdin.write('K');
    await tick(40);

    assert.deepEqual(renderedPages, [1]);
    const frame = lastChromeFrame(result);
    assert.match(frame, /page 2\/2/);
    assert.match(frame, /preview/);
  });

  test('shows a rendering placeholder for uncached preview pages', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          { lines: [createLine('Page One')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
        ]}
        previewPages={[{ ...createRasterPage(), pageNumber: 1 }]}
        renderPreviewPage={() =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ...createRasterPage(),
                  pageNumber: 2,
                }),
              60,
            );
          })
        }
      />,
    );

    result.stdin.write('K');
    await tick(20);

    assert.match(result.lastFrame() ?? '', /Rendering page 2/);
  });

  test('prefetches the next preview page without duplicate renders', async () => {
    const renderedPages: number[] = [];
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          { lines: [createLine('Page One')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
          { lines: [createLine('Page Three')], links: [] },
        ]}
        previewPages={[{ ...createRasterPage(), pageNumber: 1 }]}
        renderPreviewPage={async (pageIndex) => {
          renderedPages.push(pageIndex);
          return { ...createRasterPage(), pageNumber: pageIndex + 1 };
        }}
      />,
    );

    await tick(40);
    assert.deepEqual(renderedPages, [1]);

    result.stdin.write('K');
    await tick(40);

    assert.deepEqual(renderedPages, [1, 2]);
    assert.match(result.lastFrame() ?? '', /page 2\/3/);
  });

  test('evicts old preview pages from the render cache', async () => {
    const renderedPages: number[] = [];
    const pageBundles = Array.from({ length: 12 }, (_, index) => ({
      lines: [createLine(`Page ${index + 1}`)],
      links: [],
    }));
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={pageBundles}
        previewPages={[{ ...createRasterPage(), pageNumber: 1 }]}
        renderPreviewPage={async (pageIndex) => {
          renderedPages.push(pageIndex);
          return { ...createRasterPage(), pageNumber: pageIndex + 1 };
        }}
      />,
    );

    for (let index = 0; index < 10; index += 1) {
      result.stdin.write('K');
      await tick(40);
    }

    result.stdin.write('p');
    await tick(20);
    result.stdin.write('1');
    await tick(20);
    result.stdin.write('\r');
    await tick(40);

    assert.ok(renderedPages.filter((pageIndex) => pageIndex === 0).length >= 1);
    assert.match(lastChromeFrame(result), /page 1\/12/);
  });

  test('toggles from preview mode to text mode', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          {
            lines: [createLine('Text Mode')],
            links: [],
          },
        ]}
        previewPages={[createRasterPage()]}
      />,
    );

    result.stdin.write('t');
    await tick(20);

    const frame = result.lastFrame() ?? '';
    assert.match(frame, /Text Mode/);
    assert.match(frame, /text/);
  });

  test('repaints preview when opening the search prompt', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          {
            lines: [createLine('Find me')],
            links: [],
          },
        ]}
        previewPages={[createRasterPage()]}
      />,
    );

    await tick(20);
    const initialInlineFrameCount = countInlinePreviewFrames(result);

    result.stdin.write('/');
    await tick(20);

    assert.equal(countInlinePreviewFrames(result), initialInlineFrameCount + 1);
    assert.match(lastChromeFrame(result), /Enter submit/);

    result.stdin.write('level');
    await tick(20);

    assert.ok(countInlinePreviewFrames(result) > initialInlineFrameCount + 1);
    assert.match(lastChromeFrame(result), /Enter submit/);
  });

  test('searches preview mode with highlighted raster rendering', async () => {
    const renderedPages: Array<{
      activeHitIndex: number;
      pageIndex: number;
      query: string;
    }> = [];
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          {
            lines: [createLine('Find me')],
            links: [],
          },
        ]}
        previewPages={[createRasterPage()]}
        renderHighlightedPreviewPage={async (
          pageIndex,
          query,
          activeHitIndex,
        ) => {
          renderedPages.push({ activeHitIndex, pageIndex, query });
          return {
            ...createRasterPage(),
            png: Buffer.from('highlighted'),
          };
        }}
        textPages={[[createTextItem('Find me')]]}
      />,
    );

    result.stdin.write('/');
    await tick(20);
    result.stdin.write('Find');
    await tick(20);
    result.stdin.write('\r');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { activeHitIndex: 0, pageIndex: 0, query: 'Find' },
    ]);
    const frame = lastChromeFrame(result);
    assert.match(frame, /preview/);
    assert.match(frame, /hit 1\/1/);
  });

  test('keeps current preview visible while search highlight renders', async () => {
    let resolveHighlight: ((page: RasterPage) => void) | undefined;
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          {
            lines: [createLine('Find me')],
            links: [],
          },
        ]}
        previewPages={[createRasterPage()]}
        renderHighlightedPreviewPage={async () =>
          new Promise<RasterPage>((resolve) => {
            resolveHighlight = resolve;
          })
        }
        textPages={[[createTextItem('Find me')]]}
      />,
    );

    await tick(20);
    result.stdin.write('/');
    await tick(20);
    const promptFrameCount = countInlinePreviewFrames(result);

    result.stdin.write('Find');
    await tick(20);
    const typedPromptFrameCount = countInlinePreviewFrames(result);

    result.stdin.write('\r');
    await tick(30);

    assert.ok(typedPromptFrameCount > promptFrameCount);
    assert.equal(countInlinePreviewFrames(result), typedPromptFrameCount);
    assert.match(lastChromeFrame(result), /Enter submit/);

    resolveHighlight?.({
      ...createRasterPage(),
      png: Buffer.from('highlighted'),
    });
    await tick(40);

    assert.ok(countInlinePreviewFrames(result) > typedPromptFrameCount);
    assert.match(lastChromeFrame(result), /hit 1\/1/);
  });

  test('moves between preview search hits with n and N', async () => {
    const renderedPages: Array<{
      activeHitIndex: number;
      pageIndex: number;
      query: string;
    }> = [];
    const result = render(
      <App
        filename="resume.pdf"
        graphicsCapability="kitty"
        pages={[
          { lines: [createLine('Needle one')], links: [] },
          { lines: [createLine('Needle two')], links: [] },
        ]}
        previewPages={[
          { ...createRasterPage(), pageNumber: 1 },
          { ...createRasterPage(), pageNumber: 2 },
        ]}
        renderHighlightedPreviewPage={async (
          pageIndex,
          query,
          activeHitIndex,
        ) => {
          renderedPages.push({ activeHitIndex, pageIndex, query });
          return {
            ...createRasterPage(),
            pageNumber: pageIndex + 1,
            png: Buffer.from(`highlighted-${pageIndex}`),
          };
        }}
        textPages={[
          [createTextItem('Needle one')],
          [createTextItem('Needle two')],
        ]}
      />,
    );

    result.stdin.write('/');
    await tick(20);
    result.stdin.write('Needle');
    await tick(20);
    result.stdin.write('\r');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { activeHitIndex: 0, pageIndex: 0, query: 'Needle' },
    ]);
    let frame = lastChromeFrame(result);
    assert.match(frame, /page 1\/2/);
    assert.match(frame, /hit 1\/2/);

    result.stdin.write('n');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { activeHitIndex: 0, pageIndex: 0, query: 'Needle' },
      { activeHitIndex: 1, pageIndex: 1, query: 'Needle' },
    ]);
    frame = lastChromeFrame(result);
    assert.match(frame, /page 2\/2/);
    assert.match(frame, /hit 2\/2/);

    result.stdin.write('N');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { activeHitIndex: 0, pageIndex: 0, query: 'Needle' },
      { activeHitIndex: 1, pageIndex: 1, query: 'Needle' },
    ]);
    frame = lastChromeFrame(result);
    assert.match(frame, /page 1\/2/);
    assert.match(frame, /hit 1\/2/);
  });

  test('turns pages with J for previous and K for next', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          {
            lines: [createLine('Page One')],
            links: [],
          },
          {
            lines: [createLine('Page Two')],
            links: [],
          },
        ]}
      />,
    );

    result.stdin.write('K');
    await tick(20);
    let frame = result.lastFrame() ?? '';
    assert.match(frame, /Page Two/);
    assert.match(frame, /page 2\/2/);

    result.stdin.write('J');
    await tick(20);
    frame = result.lastFrame() ?? '';
    assert.match(frame, /Page One/);
    assert.match(frame, /page 1\/2/);
  });

  test('jumps to a page from the page prompt', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          { lines: [createLine('Page One')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
          { lines: [createLine('Page Three')], links: [] },
        ]}
      />,
    );

    result.stdin.write('p');
    await tick(20);
    result.stdin.write('3');
    await tick(20);
    result.stdin.write('\r');
    await tick(20);

    const frame = result.lastFrame() ?? '';
    assert.match(frame, /Page Three/);
    assert.match(frame, /page 3\/3/);
  });

  test('page jump clears active search navigation', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          { lines: [createLine('restaurant on page one')], links: [] },
          { lines: [createLine('Page Two')], links: [] },
          { lines: [createLine('Page Three')], links: [] },
        ]}
      />,
    );

    result.stdin.write('/');
    await tick(20);
    result.stdin.write('restaurant');
    await tick(20);
    result.stdin.write('\r');
    await tick(40);
    assert.match(result.lastFrame() ?? '', /hit 1\/1/);

    result.stdin.write('p');
    await tick(20);
    result.stdin.write('3');
    await tick(20);
    result.stdin.write('\r');
    await tick(40);

    const frame = result.lastFrame() ?? '';
    assert.match(frame, /Page Three/);
    assert.match(frame, /page 3\/3/);
    assert.match(frame, /0 hits/);
  });

  test('opens link selection mode for the current page', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          {
            lines: [createLine('Page One')],
            links: [
              createLink('GitHub', 'https://github.com/example'),
              createLink('Email', 'mailto:test@example.com'),
            ],
          },
        ]}
      />,
    );

    result.stdin.write('l');
    await tick(20);

    const frame = result.lastFrame() ?? '';
    assert.match(frame, /Links/);
    assert.match(frame, /> 1\. GitHub -> https:\/\/github\.com\/example/);
    assert.match(frame, /  2\. Email -> mailto:test@example\.com/);
    assert.match(frame, /links/);
  });

  test('moves link selection and opens the selected link', async () => {
    const openedUrls: string[] = [];
    const result = render(
      <App
        filename="resume.pdf"
        openUrl={(url) => openedUrls.push(url)}
        pages={[
          {
            lines: [createLine('Page One')],
            links: [
              createLink('GitHub', 'https://github.com/example'),
              createLink('Email', 'mailto:test@example.com'),
            ],
          },
        ]}
      />,
    );

    result.stdin.write('l');
    await tick(20);
    result.stdin.write('k');
    await tick(20);
    result.stdin.write('\r');
    await tick(20);

    assert.deepEqual(openedUrls, ['mailto:test@example.com']);
    assert.match(result.lastFrame() ?? '', /> 2\. Email/);
  });

  test('exits link selection mode with escape', async () => {
    const result = render(
      <App
        filename="resume.pdf"
        pages={[
          {
            lines: [createLine('Page One')],
            links: [createLink('GitHub', 'https://github.com/example')],
          },
        ]}
      />,
    );

    result.stdin.write('l');
    await tick(20);
    result.stdin.write('\u001B');
    await tick(20);

    const frame = result.lastFrame() ?? '';
    assert.match(frame, /Page One/);
    assert.match(frame, /normal/);
  });
});
