import process from 'node:process';
import { EventEmitter } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { render as inkRender } from 'ink';
import React from 'react';

import type { TextItem } from '../src/core/pdf-service.js';
import type { RasterPage } from '../src/core/raster.js';
import type { StyledLine } from '../src/core/structure.js';
import { App } from '../src/tui/App.js';

const DEFAULT_OUTPUT_DIR = '/tmp/foliotty-preview-states';
const HARNESS_COLUMNS = 100;
const HARNESS_ROWS = 30;

class HarnessStdout extends EventEmitter {
  columns = HARNESS_COLUMNS;
  rows = HARNESS_ROWS;
  frames: string[] = [];
  lastFrame: string | undefined;
  write = (frame: string): void => {
    this.frames.push(frame);
    this.lastFrame = frame;
  };
}

class HarnessStdin extends EventEmitter {
  isTTY = true;
  private bufferedData: string | null = null;
  write = (data: string): void => {
    this.bufferedData = data;
    this.emit('readable');
    this.emit('data', data);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const data = this.bufferedData;
    this.bufferedData = null;
    return data;
  };
}

class HarnessStderr extends EventEmitter {
  write = (): void => {};
}

type RenderResult = {
  lastFrame: () => string;
  stdin: HarnessStdin;
  unmount: () => void;
};

function harnessRender(tree: React.ReactElement): RenderResult {
  const stdout = new HarnessStdout();
  const stderr = new HarnessStderr();
  const stdin = new HarnessStdin();
  const instance = inkRender(tree, {
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  });

  return {
    lastFrame: () => {
      for (let index = stdout.frames.length - 1; index >= 0; index -= 1) {
        const frame = stdout.frames[index];

        if (frame === undefined) {
          continue;
        }

        // Skip side-channel image emits (cursor-home prefix) and full screen
        // clears so the harness returns ink's last chrome render.
        if (
          frame.startsWith('7') ||
          frame.startsWith('[H') ||
          frame.startsWith('[2J')
        ) {
          continue;
        }

        return frame;
      }

      return '';
    },
    stdin,
    unmount: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}

type SceneResult = {
  frame: string;
};

type Scene = {
  capture: () => Promise<SceneResult>;
  description: string;
  name: string;
};

function bodyLine(text: string): StyledLine {
  return {
    kind: 'body',
    runs: text.length === 0 ? [] : [{ bold: false, italic: false, text }],
    text,
  };
}

function headingLine(text: string): StyledLine {
  return {
    kind: 'h1',
    runs: [{ bold: true, italic: false, text }],
    text,
  };
}

function fakeRasterPage(pageNumber: number, label: string): RasterPage {
  return {
    displayColumns: 60,
    displayHeight: 480,
    displayRows: 20,
    displayWidth: 360,
    height: 800,
    pageNumber,
    png: Buffer.from(`fake-png-page-${pageNumber}-${label}`),
    width: 600,
  };
}

function textItem(str: string, x = 40, y = 700): TextItem {
  return {
    fontName: 'Helvetica',
    fontSize: 12,
    height: 14,
    str,
    width: str.length * 7,
    x,
    y,
  };
}

function tick(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildScenarioFixture() {
  const pages = [
    {
      lines: [
        headingLine('Jane Doe'),
        bodyLine('Software Engineer based in New York'),
        bodyLine('Senior backend engineer with five years of experience.'),
      ],
      links: [],
    },
    {
      lines: [
        headingLine('Experience'),
        bodyLine('Worked on a payments platform serving millions of users.'),
        bodyLine(
          'Designed event-driven architecture and improved reliability.',
        ),
      ],
      links: [],
    },
    {
      lines: [
        headingLine('Education'),
        bodyLine('B.S. Computer Science, City University of New York.'),
        bodyLine('Graduated with honors.'),
      ],
      links: [],
    },
  ];

  const textPages: TextItem[][] = [
    [textItem('Software Engineer based in New York', 40, 700)],
    [textItem('Designed event-driven architecture.', 40, 700)],
    [textItem('B.S. Computer Science, City University of New York', 40, 700)],
  ];

  const previewPages: RasterPage[] = [
    fakeRasterPage(1, 'doe'),
    fakeRasterPage(2, 'experience'),
    fakeRasterPage(3, 'education'),
  ];

  return { pages, previewPages, textPages };
}

async function captureInitialPreview(): Promise<SceneResult> {
  const { pages, previewPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
    }),
  );
  await tick(40);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureSearchNewYork(): Promise<SceneResult> {
  const { pages, previewPages, textPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
      renderHighlightedPreviewPage: async (pageIndex) =>
        fakeRasterPage(pageIndex + 1, `highlight-hit0-page${pageIndex + 1}`),
      textPages,
    }),
  );
  await tick(40);
  result.stdin.write('/');
  await tick(20);
  result.stdin.write('New York');
  await tick(20);
  result.stdin.write('\r');
  await tick(60);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureNextPreviewSearchHit(): Promise<SceneResult> {
  const { pages, previewPages, textPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
      renderHighlightedPreviewPage: async (pageIndex, _query, activeHitIndex) =>
        fakeRasterPage(
          pageIndex + 1,
          `highlight-hit${activeHitIndex}-page${pageIndex + 1}`,
        ),
      textPages,
    }),
  );
  await tick(40);
  result.stdin.write('/');
  await tick(20);
  result.stdin.write('New York');
  await tick(20);
  result.stdin.write('\r');
  await tick(60);
  result.stdin.write('n');
  await tick(60);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureNextPage(): Promise<SceneResult> {
  const { pages, previewPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
    }),
  );
  await tick(40);
  result.stdin.write('K');
  await tick(40);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureGoToPageThree(): Promise<SceneResult> {
  const { pages, previewPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
    }),
  );
  await tick(40);
  result.stdin.write('p');
  await tick(20);
  result.stdin.write('3');
  await tick(20);
  result.stdin.write('\r');
  await tick(40);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureTextMode(): Promise<SceneResult> {
  const { pages, previewPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages,
    }),
  );
  await tick(40);
  result.stdin.write('t');
  await tick(40);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

async function captureRenderingPlaceholder(): Promise<SceneResult> {
  const { pages, previewPages } = buildScenarioFixture();
  const result = harnessRender(
    React.createElement(App, {
      filename: 'samples/long.pdf',
      graphicsCapability: 'kitty',
      pages,
      previewPages: [previewPages[0]!],
      renderPreviewPage: () => new Promise<RasterPage>(() => {}),
    }),
  );
  await tick(40);
  result.stdin.write('K');
  await tick(40);
  const frame = result.lastFrame() ?? '';
  result.unmount();
  return { frame };
}

const SCENES: Scene[] = [
  {
    capture: captureInitialPreview,
    description: 'Initial raster preview at page 1.',
    name: '01-initial-preview',
  },
  {
    capture: captureSearchNewYork,
    description: 'Preview search for "New York" landing on the first hit.',
    name: '02-search-new-york',
  },
  {
    capture: captureNextPreviewSearchHit,
    description: 'After pressing n, the next preview search hit.',
    name: '03-next-search-hit',
  },
  {
    capture: captureNextPage,
    description: 'After pressing K, the next preview page.',
    name: '04-next-page',
  },
  {
    capture: captureGoToPageThree,
    description: 'After p3<enter>, jumped to page 3.',
    name: '05-go-to-page-3',
  },
  {
    capture: captureTextMode,
    description: 'After pressing t, toggled to text mode.',
    name: '06-text-mode',
  },
  {
    capture: captureRenderingPlaceholder,
    description: 'Uncached preview page showing the rendering placeholder.',
    name: '07-rendering-placeholder',
  },
];

async function main(): Promise<void> {
  const outputDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const manifestEntries: string[] = [];

  for (const scene of SCENES) {
    const { frame } = await scene.capture();
    await writeFile(join(outputDir, `${scene.name}.txt`), frame, 'utf8');
    manifestEntries.push(
      `${scene.name}  ${frame.length}c  ${scene.description}`,
    );
    process.stdout.write(`captured ${scene.name} (${frame.length}c)\n`);
  }

  const manifest = [
    'foliotty preview-state harness — TUI chrome/state snapshots.',
    '',
    'Each *.txt file is the last ink-rendered frame for the named scene at',
    `${HARNESS_COLUMNS}x${HARNESS_ROWS} (cols x rows). Frames capture status-bar text, mode,`,
    'page/hit counters, placeholders, and text-mode content. They do NOT capture',
    'the inline image bytes — ink drops zero-visible-width Text nodes, and the',
    'raster image is verified separately by PreviewView/renderInlinePreviewImage',
    'unit tests.',
    '',
    'Frames are deterministic: re-running the harness produces byte-identical',
    'artifacts, so diffs surface real chrome regressions.',
    '',
    'Scenes:',
    ...manifestEntries,
  ].join('\n');

  await writeFile(join(outputDir, 'MANIFEST.txt'), `${manifest}\n`, 'utf8');

  process.stdout.write(`\nwrote ${SCENES.length} scenes to ${outputDir}\n`);
}

await main();
