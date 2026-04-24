import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import React from 'react';
import { cleanup, render } from 'ink-testing-library';

import type { PdfLink } from '../../core/pdf-service.js';
import type { StyledLine } from '../../core/structure.js';
import { App } from '../App.js';

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
});
