import process from 'node:process';

import chalk from 'chalk';
import meow from 'meow';

import { detectColumns } from './core/columns.js';
import { NoTextLayerError, PdfLoadError } from './core/errors.js';
import { openPdf } from './core/pdf-service.js';
import type { PdfLink } from './core/pdf-service.js';
import { buildStyledLines } from './core/structure.js';

function renderStyledText(
  text: string,
  options: { bold: boolean; italic: boolean },
): string {
  let styled = text;

  if (options.bold) {
    styled = chalk.bold(styled);
  }

  if (options.italic) {
    styled = chalk.italic(styled);
  }

  return styled;
}

function renderLine(line: ReturnType<typeof buildStyledLines>[number]): string {
  if (line.kind === 'blank') {
    return '';
  }

  const content = line.runs
    .map((run) =>
      renderStyledText(run.text, {
        bold: run.bold,
        italic: run.italic,
      }),
    )
    .join('');

  if (line.kind === 'h1') {
    return chalk.bold.cyan.underline(content);
  }

  if (line.kind === 'h2') {
    return chalk.bold.yellow(content);
  }

  return content;
}

function renderLinks(links: PdfLink[]): string {
  if (links.length === 0) {
    return '';
  }

  return [
    chalk.bold.yellow('Links'),
    ...links.map((link) => `  • ${link.text} -> ${link.url}`),
  ].join('\n');
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
}

try {
  const document = await openPdf(filePath);
  const output = document.pages
    .map((page, index) => {
      const content = buildStyledLines(detectColumns(page))
        .map(renderLine)
        .join('\n');
      const links = renderLinks(document.pageLinks[index] ?? []);

      return links.length > 0 ? `${content}\n\n${links}` : content;
    })
    .join('\n\n');

  process.stdout.write(`${output}\n`);
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
