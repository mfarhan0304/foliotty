import process from 'node:process';
import { basename } from 'node:path';

import chalk from 'chalk';
import { render } from 'ink';
import meow from 'meow';
import React from 'react';

import { detectColumns } from './core/columns.js';
import { NoTextLayerError, PdfLoadError } from './core/errors.js';
import { openPdf } from './core/pdf-service.js';
import type { PdfLink } from './core/pdf-service.js';
import {
  RasterBackendUnavailableError,
  renderPdfPageToPng,
} from './core/raster.js';
import { searchTextItems } from './core/search.js';
import { buildStyledLines } from './core/structure.js';
import { App } from './tui/App.js';
import { detectGraphicsCapability } from './tui/graphics.js';
import { supportsInlinePreview } from './tui/PreviewView.js';
import { renderStyledLine } from './tui/render.js';

function renderLinks(links: PdfLink[]): string {
  if (links.length === 0) {
    return '';
  }

  return [
    chalk.bold.yellow('Links'),
    ...links.map((link) => `  • ${link.text} -> ${link.url}`),
  ].join('\n');
}

type PreviewFit = {
  displayColumns: number;
  displayHeight: number;
  displayRows: number;
  displayWidth: number;
  renderWidth: number;
};

const PDF_PAGE_ASPECT_RATIO = 8.5 / 11;
const PREVIEW_CELL_HEIGHT = 24;
const PREVIEW_CELL_WIDTH = 10;
const PREVIEW_RENDER_SCALE = 2;

function fitPreviewToTerminal(columns = 80, rows = 24): PreviewFit {
  const usableColumns = Math.max(20, columns - 2);
  const usableRows = Math.max(8, rows - 4);
  const maxDisplayWidth = usableColumns * PREVIEW_CELL_WIDTH;
  const maxDisplayHeight = usableRows * PREVIEW_CELL_HEIGHT;
  const widthConstrainedHeight = Math.floor(
    maxDisplayWidth / PDF_PAGE_ASPECT_RATIO,
  );
  const displayHeight = Math.min(maxDisplayHeight, widthConstrainedHeight);
  const displayWidth = Math.floor(displayHeight * PDF_PAGE_ASPECT_RATIO);

  return {
    displayColumns: Math.ceil(displayWidth / PREVIEW_CELL_WIDTH),
    displayHeight,
    displayRows: Math.ceil(displayHeight / PREVIEW_CELL_HEIGHT),
    displayWidth,
    renderWidth: displayWidth * PREVIEW_RENDER_SCALE,
  };
}

const cli = meow(
  `
    Usage
      $ foliotty <resume.pdf>

    Options
      --help     Show help
      --version  Show version
  `,
  {
    importMeta: import.meta,
  },
);

const [filePath] = cli.input;

if (!filePath) {
  cli.showHelp();
  process.exit(0);
}

try {
  const document = await openPdf(filePath);
  const pages = document.pages.map((page, index) => ({
    lines: buildStyledLines(detectColumns(page)),
    links: document.pageLinks[index] ?? [],
  }));

  if (process.stdout.isTTY && process.stdin.isTTY) {
    const graphicsCapability = detectGraphicsCapability();
    const previewFit = fitPreviewToTerminal(
      process.stdout.columns,
      process.stdout.rows,
    );
    const renderHighlightedPreviewPage = async (
      pageIndex: number,
      query: string,
    ) =>
      renderPdfPageToPng(filePath, {
        displayColumns: previewFit.displayColumns,
        displayHeight: previewFit.displayHeight,
        displayRows: previewFit.displayRows,
        displayWidth: previewFit.displayWidth,
        highlights: searchTextItems(document.pages, query)
          .filter((hit) => hit.pageIndex === pageIndex)
          .flatMap((hit) => hit.rects),
        pageNumber: pageIndex + 1,
        width: previewFit.renderWidth,
      });
    const previewPages = supportsInlinePreview(graphicsCapability)
      ? await Promise.all(
          Array.from({ length: document.numPages }, (_, index) =>
            renderPdfPageToPng(filePath, {
              displayColumns: previewFit.displayColumns,
              displayHeight: previewFit.displayHeight,
              displayRows: previewFit.displayRows,
              displayWidth: previewFit.displayWidth,
              pageNumber: index + 1,
              width: previewFit.renderWidth,
            }),
          ),
        ).catch((error: unknown) => {
          if (error instanceof RasterBackendUnavailableError) {
            return [];
          }

          throw error;
        })
      : [];

    process.stdout.write('\u001B[?1049h\u001B[2J\u001B[3J\u001B[H');

    const inkApp = render(
      React.createElement(App, {
        filename: basename(filePath),
        graphicsCapability,
        pages,
        previewPages,
        renderHighlightedPreviewPage,
        textPages: document.pages,
      }),
    );

    try {
      await inkApp.waitUntilExit();
    } finally {
      process.stdout.write('\u001B[?1049l');
    }
  } else {
    const output = pages
      .map((page) => {
        const content = page.lines
          .map((line) => renderStyledLine(line))
          .join('\n');
        const links = renderLinks(page.links);

        return links.length > 0 ? `${content}\n\n${links}` : content;
      })
      .join('\n\n');

    process.stdout.write(`${output}\n`);
  }
} catch (error) {
  if (error instanceof NoTextLayerError) {
    process.stderr.write(
      'This resume has no text layer. foliotty can only read text-searchable PDFs. If you have the original, re-export with text preserved.\n',
    );
    process.exitCode = 1;
  } else if (error instanceof PdfLoadError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write('Unexpected error while reading the PDF.\n');
    process.exitCode = 1;
  }
}
