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

    const frame = result.lastFrame() ?? '';
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

    assert.match(result.lastFrame() ?? '', /page 1\/3/);

    result.stdin.write('K');
    await tick(20);

    assert.match(result.lastFrame() ?? '', /page 2\/3/);
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

  test('searches preview mode with highlighted raster rendering', async () => {
    const renderedPages: Array<{ pageIndex: number; query: string }> = [];
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
        renderHighlightedPreviewPage={async (pageIndex, query) => {
          renderedPages.push({ pageIndex, query });
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

    assert.deepEqual(renderedPages, [{ pageIndex: 0, query: 'Find' }]);
    assert.match(result.lastFrame() ?? '', /preview/);
  });

  test('moves between preview search hits with n and N', async () => {
    const renderedPages: Array<{ pageIndex: number; query: string }> = [];
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
        renderHighlightedPreviewPage={async (pageIndex, query) => {
          renderedPages.push({ pageIndex, query });
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

    assert.deepEqual(renderedPages, [{ pageIndex: 0, query: 'Needle' }]);
    assert.match(result.lastFrame() ?? '', /page 1\/2/);

    result.stdin.write('n');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { pageIndex: 0, query: 'Needle' },
      { pageIndex: 1, query: 'Needle' },
    ]);
    assert.match(result.lastFrame() ?? '', /page 2\/2/);

    result.stdin.write('N');
    await tick(30);

    assert.deepEqual(renderedPages, [
      { pageIndex: 0, query: 'Needle' },
      { pageIndex: 1, query: 'Needle' },
    ]);
    assert.match(result.lastFrame() ?? '', /page 1\/2/);
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
