import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TextItem } from '../pdf-service.js';
import type { StyledLine } from '../structure.js';
import {
  detectAlignedTable,
  isTableLikeLine,
  postProcessTables,
  renderAsciiTable,
  renderTableBlock,
  tableAwareSpacing,
} from '../tables.js';

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

describe('isTableLikeLine', () => {
  test('detects table-like rows by row vocabulary', () => {
    assert.equal(
      isTableLikeLine([
        createItem('Head'),
        createItem('Table column subhead'),
        createItem('Subhead'),
      ]),
      true,
    );
  });

  test('does not treat normal prose as table rows', () => {
    assert.equal(
      isTableLikeLine([createItem('Equation'), createItem('(1)')]),
      false,
    );
  });
});

describe('tableAwareSpacing', () => {
  test('uses a column separator for large table-like gaps', () => {
    assert.equal(
      tableAwareSpacing(
        createItem('Head', { width: 24, x: 72 }),
        createItem('Subhead', { width: 40, x: 150 }),
        true,
      ),
      ' | ',
    );
  });

  test('returns null outside table-like rows', () => {
    assert.equal(
      tableAwareSpacing(
        createItem('Equation', { width: 45, x: 72 }),
        createItem('(1)', { width: 15, x: 180 }),
        false,
      ),
      null,
    );
  });
});

describe('detectAlignedTable', () => {
  test('detects aligned rows and columns from text geometry', () => {
    assert.deepEqual(
      detectAlignedTable([
        createItem('Name', { x: 72, y: 700 }),
        createItem('Score', { x: 180, y: 700 }),
        createItem('Ada', { x: 72, y: 684 }),
        createItem('10', { x: 180, y: 684 }),
      ]),
      {
        rows: [
          ['Name', 'Score'],
          ['Ada', '10'],
        ],
      },
    );
  });

  test('keeps empty cells when a row has a missing column', () => {
    assert.deepEqual(
      detectAlignedTable([
        createItem('Name', { x: 72, y: 700 }),
        createItem('Role', { x: 180, y: 700 }),
        createItem('Score', { x: 290, y: 700 }),
        createItem('Ada', { x: 72, y: 684 }),
        createItem('10', { x: 290, y: 684 }),
      ]),
      {
        rows: [
          ['Name', 'Role', 'Score'],
          ['Ada', '', '10'],
        ],
      },
    );
  });

  test('rejects prose without repeated aligned columns', () => {
    assert.equal(
      detectAlignedTable([
        createItem('This is a normal paragraph.', { x: 72, y: 700 }),
        createItem('It wraps on the next line.', { x: 72, y: 684 }),
      ]),
      null,
    );
  });
});

describe('renderAsciiTable', () => {
  test('renders padded terminal table rows', () => {
    assert.deepEqual(renderAsciiTable(['Name', 'Score'], ['Ada', '10']), [
      '+------+-------+',
      '| Name | Score |',
      '+------+-------+',
      '| Ada  | 10    |',
      '+------+-------+',
    ]);
  });
});

describe('renderTableBlock', () => {
  test('renders multiple data rows', () => {
    assert.deepEqual(
      renderTableBlock({
        rows: [
          ['Name', 'Score'],
          ['Ada', '10'],
          ['Lin', '9'],
        ],
      }),
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

describe('postProcessTables', () => {
  test('draws a simple table from split table header rows', () => {
    const lines = postProcessTables([
      createLine('It is recommended to Table Column Head'),
      createLine('', 'blank'),
      createLine('Table'),
      createLine('', 'blank'),
      createLine('Head | Table column subhead | Subhead | Subhead'),
      createLine('', 'blank'),
      createLine('text | Texta'),
    ]);

    assert.deepEqual(
      lines.map((line) => line.text),
      [
        'It is recommended to',
        'Table Column Head',
        '+------------+----------------------+---------+---------+',
        '| Table Head | Table column subhead | Subhead | Subhead |',
        '+------------+----------------------+---------+---------+',
        '| text       | Texta                |         |         |',
        '+------------+----------------------+---------+---------+',
      ],
    );
  });
});
