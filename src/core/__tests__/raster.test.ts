import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'node:test';

import { renderPdfPageToPng } from '../raster.js';

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

function createTextPdf(text: string): Uint8Array {
  const escapedText = text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    `(${escapedText}) Tj`,
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

describe('renderPdfPageToPng', () => {
  let tempDirectory = '';

  afterEach(async () => {
    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true });
      tempDirectory = '';
    }
  });

  test('renders a PDF page to a PNG buffer', async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'foliotty-raster-'));
    const filePath = join(tempDirectory, 'simple.pdf');
    await writeFile(filePath, createTextPdf('Preview'));

    const page = await renderPdfPageToPng(filePath, { width: 306 });

    assert.equal(page.pageNumber, 1);
    assert.equal(page.width, 306);
    assert.equal(page.height, 396);
    assert.deepEqual(
      [...page.png.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  });
});
