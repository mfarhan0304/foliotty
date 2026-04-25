import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  AnnotationType,
  OPS,
  VerbosityLevel,
  getDocument,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  PDFDocumentProxy,
  PDFOperatorList,
  PDFPageProxy,
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
  color?: string;
};

export type PdfLink = {
  text: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextDocument = {
  numPages: number;
  pages: TextItem[][];
  pageLinks: PdfLink[][];
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

function toTextItem(item: PdfJsTextItem, color: string | undefined): TextItem {
  const [scaleX = 0, skewX = 0, , scaleY = 0, x = 0, y = 0] = item.transform;
  const derivedFontSize = Math.hypot(scaleX, skewX);
  const fallbackFontSize = Math.abs(scaleY) || item.height;

  const textItem: TextItem = {
    str: item.str,
    x,
    y,
    width: item.width,
    height: item.height,
    fontName: item.fontName,
    fontSize: derivedFontSize || fallbackFontSize,
  };

  if (color !== undefined) {
    textItem.color = color;
  }

  return textItem;
}

function firstHexColor(args: unknown): string | undefined {
  if (!Array.isArray(args)) {
    return undefined;
  }

  const [value] = args;

  if (typeof value !== 'string' || !/^#[\da-f]{6}$/iu.test(value)) {
    return undefined;
  }

  return value.toLowerCase();
}

function extractTextColors(
  operatorList: PDFOperatorList,
): Array<string | undefined> {
  const colors: Array<string | undefined> = [];
  const colorStack: Array<string | undefined> = [];
  let fillColor: string | undefined;

  for (const [index, fn] of operatorList.fnArray.entries()) {
    if (fn === OPS.save) {
      colorStack.push(fillColor);
      continue;
    }

    if (fn === OPS.restore) {
      fillColor = colorStack.pop();
      continue;
    }

    if (
      fn === OPS.setFillRGBColor ||
      fn === OPS.setFillGray ||
      fn === OPS.setFillCMYKColor ||
      fn === OPS.setFillColor ||
      fn === OPS.setFillColorN
    ) {
      fillColor = firstHexColor(operatorList.argsArray[index]);
      continue;
    }

    if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      colors.push(fillColor);
    }
  }

  return colors;
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
  const colors = await extractPageTextColors(page, textContent);

  return textContent.items
    .filter(isPdfJsTextItem)
    .map((item, index) => toTextItem(item, colors[index]));
}

async function extractPageTextColors(
  page: PDFPageProxy,
  textContent: TextContent,
): Promise<Array<string | undefined>> {
  const textItems = textContent.items.filter(isPdfJsTextItem);
  const operatorList = await page.getOperatorList();
  const colors = extractTextColors(operatorList);

  return colors.length === textItems.length ? colors : [];
}

async function extractPageLinks(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfLink[]> {
  const page = await document.getPage(pageNumber);
  const annotations = await page.getAnnotations();

  return annotations
    .filter((annotation) => annotation.annotationType === AnnotationType.LINK)
    .flatMap((annotation) => {
      const url =
        typeof annotation.url === 'string'
          ? annotation.url
          : typeof annotation.unsafeUrl === 'string'
            ? annotation.unsafeUrl
            : null;

      if (url === null) {
        return [];
      }

      const rect = Array.isArray(annotation.rect) ? annotation.rect : [];
      const [left = 0, bottom = 0, right = 0, top = 0] = rect;
      const text =
        typeof annotation.overlaidText === 'string' &&
        annotation.overlaidText.trim().length > 0
          ? annotation.overlaidText.trim()
          : url;

      return [
        {
          text,
          url,
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, top - bottom),
        },
      ];
    })
    .sort((left, right) => {
      if (left.y !== right.y) {
        return right.y - left.y;
      }

      return left.x - right.x;
    });
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
    const pageLinks: PdfLink[][] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await extractPageText(document, pageNumber));
      pageLinks.push(await extractPageLinks(document, pageNumber));
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
      pageLinks,
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
