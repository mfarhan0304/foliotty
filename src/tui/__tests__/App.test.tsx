import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { cleanup, render } from 'ink-testing-library';

import type { PdfLink } from '../../core/pdf-service.js';
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
  });

  test('turns pages with J and K', async () => {
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

    result.stdin.write('J');
    await tick(20);
    let frame = result.lastFrame() ?? '';
    assert.match(frame, /Page Two/);
    assert.match(frame, /page 2\/2/);

    result.stdin.write('K');
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
});
