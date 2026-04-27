import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { render } from 'ink-testing-library';

import {
  PreviewView,
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

function createDisplayedRasterPage(): RasterPage {
  return {
    displayColumns: 10,
    displayHeight: 50,
    displayRows: 5,
    displayWidth: 40,
    height: 100,
    pageNumber: 1,
    png: Buffer.from('png'),
    width: 80,
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
      '\u001B[2J\u001B[3J\u001B[H\u001B_Ga=d,d=A\u001B\\\u001B_Ga=T,f=100;cG5n\u001B\\',
    );
  });

  test('renders iTerm inline PNG escape sequence', () => {
    assert.equal(
      renderInlinePreviewImage(createRasterPage(), 'iterm'),
      '\u001B[2J\u001B[3J\u001B[H\u001B]1337;File=inline=1;width=1px;height=1px:cG5n\u0007',
    );
  });

  test('uses explicit display dimensions when available', () => {
    assert.equal(
      renderInlinePreviewImage(createDisplayedRasterPage(), 'iterm'),
      '\u001B[2J\u001B[3J\u001B[H\u001B]1337;File=inline=1;width=40px;height=50px:cG5n\u0007',
    );
    assert.equal(
      renderInlinePreviewImage(createDisplayedRasterPage(), 'kitty'),
      '\u001B[2J\u001B[3J\u001B[H\u001B_Ga=d,d=A\u001B\\\u001B_Ga=T,f=100,c=10,r=5;cG5n\u001B\\',
    );
  });

  test('can repaint without clearing surrounding terminal chrome', () => {
    assert.equal(
      renderInlinePreviewImage(createRasterPage(), 'iterm', { clear: false }),
      '\u001B[H\u001B]1337;File=inline=1;width=1px;height=1px:cG5n\u0007',
    );
    assert.equal(
      renderInlinePreviewImage(createDisplayedRasterPage(), 'kitty', {
        clear: false,
      }),
      '\u001B[H\u001B_Ga=T,f=100,c=10,r=5;cG5n\u001B\\',
    );
  });

  test('returns null when direct PNG preview is unsupported', () => {
    assert.equal(renderInlinePreviewImage(createRasterPage(), 'sixel'), null);
  });
});

describe('PreviewView', () => {
  test('shows a rendering placeholder for uncached preview pages', () => {
    const result = render(
      <PreviewView capability="kitty" isRendering pageNumber={3} pages={[]} />,
    );

    assert.match(result.lastFrame() ?? '', /Rendering page 3/);
  });

  test('shows a terminal fallback when inline preview is unsupported', () => {
    const result = render(
      <PreviewView capability="none" pageNumber={1} pages={[]} />,
    );

    assert.match(result.lastFrame() ?? '', /Raster preview is unavailable/);
  });
});
