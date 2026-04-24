import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeSearchText, searchStyledLines } from '../search.js';
import type { StyledLine } from '../structure.js';

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
        ranges: [{ end: 6, start: 0 }],
      },
      {
        lineIndex: 1,
        ranges: [{ end: 37, start: 31 }],
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
        ranges: [{ end: 4, start: 0 }],
      },
    ]);
  });

  test('returns no hits for an empty query', () => {
    assert.deepEqual(searchStyledLines([createLine('Hello')], '   '), []);
  });
});
