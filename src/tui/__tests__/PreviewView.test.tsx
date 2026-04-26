import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  renderInlinePreviewImage,
  supportsInlinePreview,
} from '../PreviewView.js';
import type { RasterPage } from '../../core/raster.js';

function createRasterPage(content = 'png'): RasterPage {
  return {
    height: 1,
    pageNumber: 1,
    png: Buffer.from(content),
    width: 1,
  };
}

describe('supportsInlinePreview', () => {
  test('supports Kitty and iTerm inline image protocols', () => {
    assert.equal(supportsInlinePreview('kitty'), true);
    assert.equal(supportsInlinePreview('iterm'), true);
  });

  test('does not claim direct PNG support for Sixel or plain terminals', () => {
    assert.equal(supportsInlinePreview('sixel'), false);
    assert.equal(supportsInlinePreview('none'), false);
  });
});

describe('renderInlinePreviewImage', () => {
  test('renders Kitty inline PNG escape sequence', () => {
    assert.equal(
      renderInlinePreviewImage(createRasterPage(), 'kitty'),
      '\u001B_Ga=T,f=100;cG5n\u001B\\',
    );
  });

  test('renders iTerm inline PNG escape sequence', () => {
    assert.equal(
      renderInlinePreviewImage(createRasterPage(), 'iterm'),
      '\u001B]1337;File=inline=1;width=auto;height=auto:cG5n\u0007',
    );
  });

  test('returns null when direct PNG preview is unsupported', () => {
    assert.equal(renderInlinePreviewImage(createRasterPage(), 'sixel'), null);
  });
});
