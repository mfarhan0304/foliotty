import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createSearchIndex,
  normalizeSearchText,
  searchIndexedLines,
  searchStyledLines,
  searchTextItems,
} from '../search.js';
import type { StyledLine } from '../structure.js';
import type { TextItem } from '../pdf-service.js';

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

function createItem(str: string, x = 10, y = 20, width = 80): TextItem {
  return {
    fontName: 'Body',
    fontSize: 10,
    height: 10,
    str,
    width,
    x,
    y,
  };
}

describe('normalizeSearchText', () => {
  test('normalizes compatibility forms and combining marks', () => {
    assert.equal(normalizeSearchText('Café ﬁle'), 'cafe file');
  });

  test('strips private-use glyphs', () => {
    assert.equal(normalizeSearchText('\uE000hello'), 'hello');
  });
});

describe('searchStyledLines', () => {
  test('returns hits with line indexes and character ranges', () => {
    const hits = searchStyledLines(
      [
        createLine('Python and TypeScript'),
        createLine('Built distributed systems with Python'),
      ],
      'Python',
    );

    assert.deepEqual(hits, [
      {
        lineIndex: 0,
        range: { end: 6, start: 0 },
      },
      {
        lineIndex: 1,
        range: { end: 37, start: 31 },
      },
    ]);
  });

  test('finds accent-insensitive matches and skips blank lines', () => {
    const hits = searchStyledLines(
      [createLine('Café systems'), createLine('', 'blank')],
      'cafe',
    );

    assert.deepEqual(hits, [
      {
        lineIndex: 0,
        range: { end: 4, start: 0 },
      },
    ]);
  });

  test('returns no hits for an empty query', () => {
    assert.deepEqual(searchStyledLines([createLine('Hello')], '   '), []);
  });
});

describe('searchIndexedLines', () => {
  test('returns the same hits as linear search', () => {
    const lines = [
      createLine('Python and TypeScript'),
      createLine('Blank should not match', 'blank'),
      createLine('Built distributed systems with Python'),
      createLine('Python Python'),
    ];
    const index = createSearchIndex(lines);

    assert.deepEqual(
      searchIndexedLines(index, 'Python'),
      searchStyledLines(lines, 'Python'),
    );
  });

  test('supports short queries by scanning indexed nonblank lines', () => {
    const lines = [
      createLine('AI systems'),
      createLine('Typed text'),
      createLine('', 'blank'),
    ];
    const index = createSearchIndex(lines);

    assert.deepEqual(searchIndexedLines(index, 'ai'), [
      {
        lineIndex: 0,
        range: { end: 2, start: 0 },
      },
    ]);
  });

  test('returns no candidates when a query trigram is absent', () => {
    const index = createSearchIndex([
      createLine('restaurant reviews'),
      createLine('inspection outcomes'),
    ]);

    assert.deepEqual(searchIndexedLines(index, 'zucchini'), []);
  });

  test('records only searchable nonblank lines in the index', () => {
    const index = createSearchIndex([
      createLine('', 'blank'),
      createLine('\uE000'),
      createLine('Searchable text'),
    ]);

    assert.equal(index.indexedLineCount, 1);
  });
});

describe('searchTextItems', () => {
  test('returns page-local rectangles for raw text item hits', () => {
    assert.deepEqual(searchTextItems([[createItem('hello world')]], 'world'), [
      {
        pageIndex: 0,
        rects: [
          {
            height: 10,
            width: (80 * 5) / 11,
            x: (80 * 6) / 11 + 10,
            y: 20,
          },
        ],
      },
    ]);
  });

  test('returns no hits for an empty query', () => {
    assert.deepEqual(searchTextItems([[createItem('hello')]], '  '), []);
  });
});
