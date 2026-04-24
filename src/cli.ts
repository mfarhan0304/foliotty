import process from 'node:process';

import meow from 'meow';

import { detectColumns } from './core/columns.js';
import { NoTextLayerError, PdfLoadError } from './core/errors.js';
import { openPdf } from './core/pdf-service.js';

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
    .map((page) =>
      detectColumns(page)
        .orderedItems.map((item) => item.str)
        .join(' '),
    )
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
