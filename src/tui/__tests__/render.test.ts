import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import chalk from 'chalk';

import { renderStyledLine, renderStyledLineSlice } from '../render.js';
import type { StyledLine } from '../../core/structure.js';

chalk.level = 3;

describe('renderStyledLine', () => {
  test('applies run-level PDF text colors', () => {
    const rendered = renderStyledLine({
      kind: 'body',
      runs: [
        { bold: false, color: '#ff0000', italic: false, text: 'Red' },
        { bold: false, color: '#0000ff', italic: false, text: ' Blue' },
      ],
      text: 'Red Blue',
    });

    assert.match(rendered, /\u001B\[38;2;255;0;0mRed/);
    assert.match(rendered, /\u001B\[38;2;0;0;255m Blue/);
  });
});

describe('renderStyledLineSlice', () => {
  test('preserves run-level colors when slicing wrapped rows', () => {
    const line: StyledLine = {
      kind: 'body',
      runs: [
        { bold: false, color: '#ff0000', italic: false, text: 'Red' },
        { bold: false, color: '#0000ff', italic: false, text: ' Blue' },
      ],
      text: 'Red Blue',
    };

    const rendered = renderStyledLineSlice(line, 4, 8);

    assert.match(rendered, /\u001B\[38;2;0;0;255mBlue/);
  });
});
