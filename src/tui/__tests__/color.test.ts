import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { safeTerminalTextColor } from '../color.js';

describe('safeTerminalTextColor', () => {
  test('rejects invalid colors', () => {
    assert.equal(safeTerminalTextColor('red'), null);
    assert.equal(safeTerminalTextColor('#fff'), null);
  });

  test('drops neutral near-black colors', () => {
    assert.equal(safeTerminalTextColor('#050505'), null);
  });

  test('drops neutral near-white colors', () => {
    assert.equal(safeTerminalTextColor('#fafafa'), null);
  });

  test('keeps normal accent colors', () => {
    assert.equal(safeTerminalTextColor('#ff0000'), '#ff0000');
    assert.equal(safeTerminalTextColor('#0000FF'), '#0000ff');
  });
});
