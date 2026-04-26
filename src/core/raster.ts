import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AnnotationMode,
  VerbosityLevel,
  getDocument,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api.js';

export type CanvasBackend = {
  createCanvas: (width: number, height: number) => CanvasLike;
};

export type RasterPage = {
  height: number;
  pageNumber: number;
  png: Buffer;
  width: number;
};

export type HighlightRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type RenderPdfPageOptions = {
  canvasBackend?: CanvasBackend;
  highlights?: HighlightRect[];
  pageNumber?: number;
  scale?: number;
  width?: number;
};

type CanvasLike = {
  getContext: (contextType: '2d') => CanvasContextLike;
  toBuffer: (mimeType: 'image/png') => Buffer;
};

type CanvasContextLike = {
  fillRect: (x: number, y: number, width: number, height: number) => void;
  fillStyle: string;
};

export class RasterBackendUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'PDF preview requires optional dependency "@napi-rs/canvas". Install optional dependencies to enable preview rendering.',
      options,
    );
    this.name = 'RasterBackendUnavailableError';
  }
}

const pdfJsPackageRoot = dirname(
  dirname(
    dirname(
      createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs'),
    ),
  ),
);
const standardFontDataUrl = `${pathToFileURL(join(pdfJsPackageRoot, 'standard_fonts')).toString()}/`;

function isCanvasBackend(value: unknown): value is CanvasBackend {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createCanvas' in value &&
    typeof value.createCanvas === 'function'
  );
}

async function loadCanvasBackend(): Promise<CanvasBackend> {
  try {
    const backend = await import('@napi-rs/canvas');

    if (!isCanvasBackend(backend)) {
      throw new RasterBackendUnavailableError();
    }

    return backend;
  } catch (error) {
    if (error instanceof RasterBackendUnavailableError) {
      throw error;
    }

    throw new RasterBackendUnavailableError({ cause: error });
  }
}

async function openPdfDocument(filePath: string): Promise<PDFDocumentProxy> {
  const fileBuffer = await readFile(filePath);
  const data = new Uint8Array(
    fileBuffer.buffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength,
  );

  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS,
  });

  return loadingTask.promise;
}

export async function renderPdfPageToPng(
  filePath: string,
  {
    canvasBackend,
    highlights = [],
    pageNumber = 1,
    scale = 1,
    width,
  }: RenderPdfPageOptions = {},
): Promise<RasterPage> {
  const backend = canvasBackend ?? (await loadCanvasBackend());
  let document: PDFDocumentProxy | undefined;

  try {
    document = await openPdfDocument(filePath);
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const resolvedScale =
      width === undefined ? scale : width / baseViewport.width;
    const viewport = page.getViewport({ scale: resolvedScale });
    const canvasWidth = Math.ceil(viewport.width);
    const canvasHeight = Math.ceil(viewport.height);
    const canvas = backend.createCanvas(canvasWidth, canvasHeight);
    const canvasContext = canvas.getContext('2d');

    await page.render({
      annotationMode: AnnotationMode.DISABLE,
      background: 'rgb(255,255,255)',
      canvas: null,
      canvasContext: canvasContext as CanvasRenderingContext2D,
      viewport,
    }).promise;

    if (highlights.length > 0) {
      canvasContext.fillStyle = 'rgba(255, 230, 0, 0.45)';

      for (const rect of highlights) {
        canvasContext.fillRect(
          rect.x * resolvedScale,
          viewport.height - (rect.y + rect.height) * resolvedScale,
          rect.width * resolvedScale,
          rect.height * resolvedScale,
        );
      }
    }

    return {
      height: canvasHeight,
      pageNumber,
      png: canvas.toBuffer('image/png'),
      width: canvasWidth,
    };
  } finally {
    await document?.destroy();
  }
}
