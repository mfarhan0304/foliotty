type RgbColor = {
  blue: number;
  green: number;
  red: number;
};

function parseHexColor(color: string): RgbColor | null {
  const match =
    /^#(?<red>[\da-f]{2})(?<green>[\da-f]{2})(?<blue>[\da-f]{2})$/iu.exec(
      color,
    );

  if (match?.groups === undefined) {
    return null;
  }

  return {
    blue: Number.parseInt(match.groups.blue ?? '', 16),
    green: Number.parseInt(match.groups.green ?? '', 16),
    red: Number.parseInt(match.groups.red ?? '', 16),
  };
}

function relativeLuminance({ blue, green, red }: RgbColor): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function chroma({ blue, green, red }: RgbColor): number {
  return (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
}

export function safeTerminalTextColor(
  color: string | undefined,
): string | null {
  if (color === undefined) {
    return null;
  }

  const parsed = parseHexColor(color);

  if (parsed === null) {
    return null;
  }

  const luminance = relativeLuminance(parsed);
  const saturation = chroma(parsed);
  const neutralNearBackground =
    saturation < 0.08 && (luminance < 0.12 || luminance > 0.9);

  return neutralNearBackground ? null : color.toLowerCase();
}
