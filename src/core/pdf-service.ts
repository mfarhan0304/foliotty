import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { VerbosityLevel, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  PDFDocumentProxy,
  TextContent,
  TextItem as PdfJsTextItem,
} from 'pdfjs-dist/types/src/display/api.js';

import { NoTextLayerError, PdfLoadError } from './errors.js';

export type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
};

export type PdfTextDocument = {
  numPages: number;
  pages: TextItem[][];
};

const pdfJsPackageRoot = dirname(
  dirname(
    dirname(
      createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs'),
    ),
  ),
);
const standardFontDataUrl = `${pathToFileURL(join(pdfJsPackageRoot, 'standard_fonts')).toString()}/`;

function isPdfJsTextItem(
  item: TextContent['items'][number],
): item is PdfJsTextItem {
  return 'str' in item;
}

function toTextItem(item: PdfJsTextItem): TextItem {
  const [scaleX = 0, skewX = 0, , scaleY = 0, x = 0, y = 0] = item.transform;
  const derivedFontSize = Math.hypot(scaleX, skewX);
  const fallbackFontSize = Math.abs(scaleY) || item.height;

  return {
    str: item.str,
    x,
    y,
    width: item.width,
    height: item.height,
    fontName: item.fontName,
    fontSize: derivedFontSize || fallbackFontSize,
  };
}

async function extractPageText(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<TextItem[]> {
  const page = await document.getPage(pageNumber);
  const textContent = await page.getTextContent({
    disableNormalization: true,
    includeMarkedContent: false,
  });

  return textContent.items.filter(isPdfJsTextItem).map(toTextItem);
}

export async function openPdf(filePath: string): Promise<PdfTextDocument> {
  const fileBuffer = await readFile(filePath);
  const data = new Uint8Array(
    fileBuffer.buffer,
    fileBuffer.byteOffset,
    fileBuffer.byteLength,
  );

  let document: PDFDocumentProxy | undefined;

  try {
    const loadingTask = getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      standardFontDataUrl,
      useSystemFonts: false,
      verbosity: VerbosityLevel.ERRORS,
    });

    document = await loadingTask.promise;

    const pages: TextItem[][] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await extractPageText(document, pageNumber));
    }

    const hasText = pages.some((items) =>
      items.some((item) => item.str.trim().length > 0),
    );

    if (!hasText) {
      throw new NoTextLayerError();
    }

    return {
      numPages: document.numPages,
      pages,
    };
  } catch (error) {
    if (error instanceof NoTextLayerError) {
      throw error;
    }

    const label = basename(filePath);
    throw new PdfLoadError(`Failed to load PDF "${label}".`, { cause: error });
  } finally {
    await document?.destroy();
  }
}
