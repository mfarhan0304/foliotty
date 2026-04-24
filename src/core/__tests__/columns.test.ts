import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectColumns } from '../columns.js';
import type { TextItem } from '../pdf-service.js';

function createItem(
  str: string,
  x: number,
  y: number,
  width = 80,
  height = 12,
): TextItem {
  return {
    str,
    x,
    y,
    width,
    height,
    fontName: 'Helvetica',
    fontSize: 12,
  };
}

describe('detectColumns', () => {
  test('keeps single-column content in top-to-bottom order', () => {
    const layout = detectColumns([
      createItem('Third', 72, 650),
      createItem('First', 72, 700),
      createItem('Second', 72, 675),
    ]);

    assert.equal(layout.columns.length, 1);
    assert.deepEqual(
      layout.orderedItems.map((item) => item.str),
      ['First', 'Second', 'Third'],
    );
  });

  test('separates a two-column page and emits left column before right column', () => {
    const layout = detectColumns([
      createItem('Right Top', 310, 700),
      createItem('Left Bottom', 72, 650),
      createItem('Left Top', 72, 700),
      createItem('Right Bottom', 310, 650),
    ]);

    assert.equal(layout.columns.length, 2);
    assert.deepEqual(
      layout.columns.map((column) => column.items.map((item) => item.str)),
      [
        ['Left Top', 'Left Bottom'],
        ['Right Top', 'Right Bottom'],
      ],
    );
    assert.deepEqual(
      layout.orderedItems.map((item) => item.str),
      ['Left Top', 'Left Bottom', 'Right Top', 'Right Bottom'],
    );
  });

  test('keeps wide header and footer spans outside the main column flow', () => {
    const layout = detectColumns([
      createItem('Header', 40, 760, 520),
      createItem('Left Top', 72, 700),
      createItem('Left Bottom', 72, 660),
      createItem('Right Top', 320, 700),
      createItem('Right Bottom', 320, 660),
      createItem('Footer', 40, 620, 520),
    ]);

    assert.deepEqual(
      layout.spanningItems.map((item) => item.str),
      ['Header', 'Footer'],
    );
    assert.deepEqual(
      layout.orderedItems.map((item) => item.str),
      [
        'Header',
        'Left Top',
        'Left Bottom',
        'Right Top',
        'Right Bottom',
        'Footer',
      ],
    );
  });

  test('drops obvious horizontal outliers that do not fit any column cluster', () => {
    const layout = detectColumns([
      createItem('Left Top', 72, 700),
      createItem('Left Bottom', 72, 660),
      createItem('Right Top', 300, 700),
      createItem('Right Bottom', 300, 660),
      createItem('Watermark', 620, 680, 30),
    ]);

    assert.deepEqual(
      layout.columns.map((column) => column.items.map((item) => item.str)),
      [
        ['Left Top', 'Left Bottom'],
        ['Right Top', 'Right Bottom'],
      ],
    );
    assert.deepEqual(
      layout.droppedItems.map((item) => item.str),
      ['Watermark'],
    );
    assert.deepEqual(
      layout.orderedItems.map((item) => item.str),
      ['Left Top', 'Left Bottom', 'Right Top', 'Right Bottom'],
    );
  });
});
