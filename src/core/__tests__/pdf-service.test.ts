import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { NoTextLayerError } from '../errors.js';
import { openPdf } from '../pdf-service.js';

function createPdf(objects: string[]): Uint8Array {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function createTextPdf(lines: string[]): Uint8Array {
  const escapedLines = lines.map((line) =>
    line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'),
  );

  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    ...escapedLines.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : ['0 -24 Td', `(${line}) Tj`],
    ),
    'ET',
  ].join('\n');

  return createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

function createBlankPdf(): Uint8Array {
  const content = ['0.9 g', '0 0 612 792 re', 'f'].join('\n');

  return createPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

describe('openPdf', () => {
  let tempDirectory = '';

  afterEach(async () => {
    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true });
      tempDirectory = '';
    }
  });

  test('extracts text items from a simple PDF', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'foliotty-'));
    const filePath = join(tempDirectory, 'simple.pdf');
    await writeFile(
      filePath,
      createTextPdf(['Jane Doe', 'TypeScript Engineer']),
    );

    const document = await openPdf(filePath);

    assert.equal(document.numPages, 1);
    assert.deepEqual(
      document.pages[0].map((item) => item.str),
      ['Jane Doe', 'TypeScript Engineer'],
    );
    assert.equal(typeof document.pages[0][0]?.fontName, 'string');
    assert.equal(typeof document.pages[0][0]?.fontSize, 'number');
    assert.equal(typeof document.pages[0][0]?.height, 'number');
    assert.equal(typeof document.pages[0][0]?.width, 'number');
    assert.equal(typeof document.pages[0][0]?.x, 'number');
    assert.equal(typeof document.pages[0][0]?.y, 'number');
  });

  test('throws when the PDF has no text layer', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'foliotty-'));
    const filePath = join(tempDirectory, 'blank.pdf');
    await writeFile(filePath, createBlankPdf());

    await assert.rejects(() => openPdf(filePath), NoTextLayerError);
  });

  test('extracts hyperlink annotations when they exist', async () => {
    const fixturePath = fileURLToPath(
      new URL('../../../samples/word.pdf', import.meta.url),
    );

    const document = await openPdf(fixturePath);
    const firstLink = document.pageLinks[0]?.[0];

    assert.ok((document.pageLinks[0]?.length ?? 0) > 0);
    assert.equal(firstLink?.text, 'm.farhan@nyu.edu');
    assert.equal(firstLink?.url, 'mailto:m.farhan@nyu.edu');
    assert.equal(typeof firstLink?.x, 'number');
    assert.equal(typeof firstLink?.y, 'number');
  });
});
