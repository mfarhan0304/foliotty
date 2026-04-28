import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectGraphicsCapability } from '../graphics.js';

describe('detectGraphicsCapability', () => {
  test('detects Kitty graphics support from KITTY_WINDOW_ID', () => {
    assert.equal(detectGraphicsCapability({ KITTY_WINDOW_ID: '12' }), 'kitty');
  });

  test('detects Kitty graphics support from TERM', () => {
    assert.equal(detectGraphicsCapability({ TERM: 'xterm-kitty' }), 'kitty');
  });

  test('detects iTerm2 inline image support', () => {
    assert.equal(
      detectGraphicsCapability({ TERM_PROGRAM: 'iTerm.app' }),
      'iterm',
    );
  });

  test('detects Sixel support from terminal markers', () => {
    assert.equal(detectGraphicsCapability({ TERM: 'xterm-sixel' }), 'sixel');
    assert.equal(
      detectGraphicsCapability({ TERMINAL_EMULATOR: 'foot-sixel' }),
      'sixel',
    );
  });

  test('prefers explicit Kitty markers over broader terminal markers', () => {
    assert.equal(
      detectGraphicsCapability({
        KITTY_WINDOW_ID: '12',
        TERM: 'xterm-sixel',
      }),
      'kitty',
    );
  });

  test('returns none when no graphics protocol is detected', () => {
    assert.equal(detectGraphicsCapability({ TERM: 'xterm-256color' }), 'none');
  });

  test('FOLIOTTY_GRAPHICS overrides detection', () => {
    assert.equal(
      detectGraphicsCapability({
        FOLIOTTY_GRAPHICS: 'iterm',
        TERM: 'xterm-256color',
      }),
      'iterm',
    );
    assert.equal(
      detectGraphicsCapability({
        FOLIOTTY_GRAPHICS: 'kitty',
        TERM_PROGRAM: 'iTerm.app',
      }),
      'kitty',
    );
  });

  test('FOLIOTTY_GRAPHICS ignores unknown values', () => {
    assert.equal(
      detectGraphicsCapability({
        FOLIOTTY_GRAPHICS: 'bogus',
        TERM_PROGRAM: 'iTerm.app',
      }),
      'iterm',
    );
  });
});
