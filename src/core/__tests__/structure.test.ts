import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ColumnLayout } from '../columns.js';
import { buildStyledLines } from '../structure.js';
import type { TextItem } from '../pdf-service.js';

function createItem(
  str: string,
  {
    fontName = 'BodyFont',
    fontSize = 10,
    height = fontSize,
    width = 80,
    x = 72,
    y = 700,
  }: Partial<TextItem> = {},
): TextItem {
  return {
    str,
    fontName,
    fontSize,
    height,
    width,
    x,
    y,
  };
}

function createLayout(items: TextItem[]): ColumnLayout {
  return {
    columns: [{ x: items[0]?.x ?? 0, items }],
    droppedItems: [],
    orderedItems: items,
    spanningItems: [],
  };
}

describe('buildStyledLines', () => {
  test('detects h1 and h2 headings from font-size deltas', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('Jane Doe', { fontName: 'BoldFont', fontSize: 22, y: 720 }),
        createItem('Experience', {
          fontName: 'BoldFont',
          fontSize: 14,
          y: 680,
        }),
        createItem('Built systems', {
          fontName: 'BodyFont',
          fontSize: 10,
          y: 660,
        }),
      ]),
    );

    assert.deepEqual(
      lines.map((line) => [line.kind, line.text]),
      [
        ['h1', 'Jane Doe'],
        ['blank', ''],
        ['h2', 'Experience'],
        ['blank', ''],
        ['body', 'Built systems'],
      ],
    );
  });

  test('marks bold and italic runs from font names', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('Acme Corp', {
          fontName: 'SourceSans-Bold',
          fontSize: 10,
          width: 60,
          x: 72,
          y: 700,
        }),
        createItem('Senior Engineer', {
          fontName: 'SourceSans-Italic',
          fontSize: 10,
          width: 90,
          x: 150,
          y: 700,
        }),
      ]),
    );

    assert.equal(lines[0]?.kind, 'body');
    assert.deepEqual(lines[0]?.runs, [
      { bold: true, italic: false, text: 'Acme Corp' },
      { bold: false, italic: true, text: ' Senior Engineer' },
    ]);
  });

  test('normalizes bullet markers to a consistent prefix', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('·', { fontName: 'BulletFont', width: 5, x: 72, y: 700 }),
        createItem('Built APIs', {
          fontName: 'BodyFont',
          width: 60,
          x: 84,
          y: 700,
        }),
      ]),
    );

    assert.equal(lines[0]?.kind, 'bullet');
    assert.equal(lines[0]?.text, '  • Built APIs');
  });

  test('inserts blank lines for large vertical gaps', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('Summary', { fontSize: 14, y: 720 }),
        createItem('Built APIs', { fontSize: 10, y: 700 }),
        createItem('Education', { fontSize: 14, y: 650 }),
      ]),
    );

    assert.deepEqual(
      lines.map((line) => line.kind),
      ['h1', 'blank', 'body', 'blank', 'h1'],
    );
  });

  test('strips private-use glyphs from output', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('\uE000', { fontName: 'IconFont', width: 5, x: 72, y: 700 }),
        createItem('hello@example.com', {
          fontName: 'BodyFont',
          width: 100,
          x: 84,
          y: 700,
        }),
      ]),
    );

    assert.equal(lines[0]?.text, 'hello@example.com');
  });

  test('renders large same-line gaps as table column separators', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('Table Head', { width: 50, x: 72, y: 700 }),
        createItem('Column Head', { width: 70, x: 180, y: 700 }),
        createItem('text', { width: 40, x: 72, y: 680 }),
        createItem('Text', { width: 30, x: 180, y: 680 }),
      ]),
    );

    assert.deepEqual(
      lines.map((line) => line.text),
      ['Table Head | Column Head', '', 'text | Text'],
    );
  });

  test('post-processes split table rows into an ASCII table', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('It is recommended to', { width: 100, x: 72, y: 720 }),
        createItem('Table Column Head', { width: 90, x: 220, y: 720 }),
        createItem('Table', { width: 30, x: 72, y: 700 }),
        createItem('Head', { width: 30, x: 72, y: 680 }),
        createItem('Table column subhead', { width: 100, x: 150, y: 680 }),
        createItem('Subhead', { width: 40, x: 280, y: 680 }),
        createItem('Subhead', { width: 40, x: 350, y: 680 }),
        createItem('text', { width: 30, x: 72, y: 660 }),
        createItem('Texta', { width: 35, x: 150, y: 660 }),
      ]),
    );

    assert.ok(lines.some((line) => line.text.startsWith('+------------+')));
    assert.ok(lines.some((line) => line.text.includes('| Table Head |')));
  });

  test('renders aligned table blocks from item geometry', () => {
    const lines = buildStyledLines(
      createLayout([
        createItem('Name', { width: 40, x: 72, y: 700 }),
        createItem('Score', { width: 40, x: 180, y: 700 }),
        createItem('Ada', { width: 24, x: 72, y: 684 }),
        createItem('10', { width: 16, x: 180, y: 684 }),
        createItem('Lin', { width: 24, x: 72, y: 668 }),
        createItem('9', { width: 8, x: 180, y: 668 }),
      ]),
    );

    assert.deepEqual(
      lines.map((line) => line.text),
      [
        '+------+-------+',
        '| Name | Score |',
        '+------+-------+',
        '| Ada  | 10    |',
        '| Lin  | 9     |',
        '+------+-------+',
      ],
    );
  });
});
