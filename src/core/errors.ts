export class PdfLoadError extends Error {
  public readonly cause: unknown;

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PdfLoadError';
    this.cause = options?.cause;
  }
}

export class NoTextLayerError extends Error {
  public constructor(message = 'This PDF has no text layer.') {
    super(message);
    this.name = 'NoTextLayerError';
  }
}
