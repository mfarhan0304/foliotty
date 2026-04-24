import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SWIFT_OCR_SOURCE = `import Foundation
import Vision
import AppKit

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let image = NSImage(contentsOf: url) else {
  fputs("failed to load image\\n", stderr)
  exit(1)
}
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
  fputs("failed to decode image\\n", stderr)
  exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])
let observations = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(observations.joined(separator: "\\n"))
`;

type ComparisonResult = {
  file: string;
  foliottyExitCode: number;
  status: 'MATCH' | 'DIFF';
  charSimilarity: number;
  uniqueJaccard: number;
  positional: number;
  foliottySample: string;
  ocrSample: string;
};

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}@.+-]+/u)
    .filter(Boolean);
}

function truncate(text: string, limit = 180): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let indexA = 1; indexA <= a.length; indexA += 1) {
    let previous = row[0] ?? 0;
    row[0] = indexA;

    for (let indexB = 1; indexB <= b.length; indexB += 1) {
      const nextPrevious = row[indexB] ?? 0;

      row[indexB] =
        a[indexA - 1] === b[indexB - 1]
          ? previous
          : Math.min(
              previous + 1,
              (row[indexB] ?? 0) + 1,
              (row[indexB - 1] ?? 0) + 1,
            );

      previous = nextPrevious;
    }
  }

  return row[b.length] ?? 0;
}

function uniqueJaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function positionalMatchRatio(left: string[], right: string[]): number {
  const maxLength = Math.max(left.length, right.length);

  if (maxLength === 0) {
    return 1;
  }

  let matches = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] === right[index]) {
      matches += 1;
    }
  }

  return matches / maxLength;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function collectPdfs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectPdfs(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.pdf$/iu.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function discoverInputDirectories(): Promise<string[]> {
  const configured = process.argv.slice(2);
  const defaults = ['samples', 'sample'];
  const candidates = configured.length > 0 ? configured : defaults;
  const existing: string[] = [];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        existing.push(candidate);
      }
    } catch {
      // Ignore missing directories so the script still works on clean checkouts.
    }
  }

  return existing;
}

async function renderPdf(
  pdfPath: string,
  outputPrefix: string,
): Promise<string[]> {
  await execFileAsync('pdftoppm', ['-png', pdfPath, outputPrefix]);

  const parent = dirname(outputPrefix);
  const prefixName = basename(outputPrefix);
  const entries = await readdir(parent);

  return entries
    .filter(
      (entry) => entry.startsWith(`${prefixName}-`) && entry.endsWith('.png'),
    )
    .sort()
    .map((entry) => join(parent, entry));
}

async function runOcr(
  swiftFile: string,
  imagePaths: string[],
): Promise<string> {
  const parts: string[] = [];

  for (const imagePath of imagePaths) {
    const { stdout } = await execFileAsync('swift', [swiftFile, imagePath]);
    parts.push(stdout.trimEnd());
  }

  return parts.join('\n');
}

async function comparePdf(
  pdfPath: string,
  scratchDirectory: string,
  swiftFile: string,
): Promise<ComparisonResult> {
  const workDirectory = join(scratchDirectory, basename(pdfPath, '.pdf'));
  const imagePrefix = join(workDirectory, 'page');

  await rm(workDirectory, { force: true, recursive: true });
  await execFileAsync('mkdir', ['-p', workDirectory]);

  const foliottyRun = await execFileAsync('bun', ['run', 'src/cli.ts', pdfPath], {
    cwd: process.cwd(),
  }).catch((error: unknown) => {
    const execError = error as {
      code?: number;
      stderr?: string;
      stdout?: string;
    };

    return {
      stderr: execError.stderr ?? '',
      stdout: execError.stdout ?? '',
      exitCode: execError.code ?? 1,
    };
  });

  const foliottyStdout = 'stdout' in foliottyRun ? foliottyRun.stdout : '';
  const foliottyStderr = 'stderr' in foliottyRun ? foliottyRun.stderr : '';
  const foliottyExitCode = 'exitCode' in foliottyRun ? foliottyRun.exitCode : 0;

  const imagePaths = await renderPdf(pdfPath, imagePrefix);
  const ocrText = await runOcr(swiftFile, imagePaths);

  await Promise.all([
    writeFile(join(workDirectory, 'foliotty.txt'), foliottyStdout),
    writeFile(join(workDirectory, 'foliotty.stderr'), foliottyStderr),
    writeFile(join(workDirectory, 'ocr.txt'), ocrText),
  ]);

  const foliottyNormalized = normalize(foliottyStdout);
  const ocrNormalized = normalize(ocrText);
  const foliottyTokens = tokenize(foliottyStdout);
  const ocrTokens = tokenize(ocrText);
  const editDistance = levenshtein(
    foliottyNormalized.toLowerCase(),
    ocrNormalized.toLowerCase(),
  );
  const maxLength = Math.max(foliottyNormalized.length, ocrNormalized.length, 1);

  return {
    file: pdfPath,
    foliottyExitCode,
    status: foliottyNormalized === ocrNormalized ? 'MATCH' : 'DIFF',
    charSimilarity: 1 - editDistance / maxLength,
    uniqueJaccard: uniqueJaccard(foliottyTokens, ocrTokens),
    positional: positionalMatchRatio(foliottyTokens, ocrTokens),
    foliottySample: truncate(foliottyNormalized),
    ocrSample: truncate(ocrNormalized),
  };
}

function printResults(results: ComparisonResult[]): void {
  let failed = 0;

  for (const result of results) {
    if (result.status === 'DIFF') {
      failed += 1;
    }

    process.stdout.write(`FILE: ${result.file}\n`);
    process.stdout.write(`STATUS: ${result.status}\n`);
    process.stdout.write(`FOLIOTTY_EXIT: ${result.foliottyExitCode}\n`);
    process.stdout.write(
      `CHAR_SIMILARITY: ${result.charSimilarity.toFixed(3)}\n`,
    );
    process.stdout.write(
      `UNIQUE_JACCARD: ${result.uniqueJaccard.toFixed(3)}\n`,
    );
    process.stdout.write(`POSITIONAL_MATCH: ${result.positional.toFixed(3)}\n`);
    process.stdout.write(`FOLIOTTY_SAMPLE: ${result.foliottySample}\n`);
    process.stdout.write(`OCR_SAMPLE: ${result.ocrSample}\n`);
    process.stdout.write('===\n');
  }

  process.stdout.write(
    `SUMMARY: ${results.length - failed} match, ${failed} diff, ${results.length} total\n`,
  );
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'compare-samples currently requires macOS because OCR uses Vision via Swift.',
    );
  }

  const [hasPdftoppm, hasSwift] = await Promise.all([
    commandExists('pdftoppm'),
    commandExists('swift'),
  ]);

  if (!hasPdftoppm) {
    throw new Error('Missing required dependency: pdftoppm');
  }

  if (!hasSwift) {
    throw new Error('Missing required dependency: swift');
  }

  const directories = await discoverInputDirectories();

  if (directories.length === 0) {
    throw new Error(
      'No sample directories found. Expected ./samples or ./sample, or pass directories as arguments.',
    );
  }

  const pdfs = (
    await Promise.all(directories.map((directory) => collectPdfs(directory)))
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));

  if (pdfs.length === 0) {
    throw new Error(`No PDFs found under: ${directories.join(', ')}`);
  }

  const scratchDirectory = await mkdtemp(join(tmpdir(), 'foliotty-compare-'));
  const swiftFile = join(scratchDirectory, 'ocr.swift');

  await writeFile(swiftFile, SWIFT_OCR_SOURCE);

  try {
    const results: ComparisonResult[] = [];

    for (const pdf of pdfs) {
      results.push(await comparePdf(pdf, scratchDirectory, swiftFile));
    }

    printResults(results);
  } finally {
    await rm(scratchDirectory, { force: true, recursive: true });
  }
}

await main();
