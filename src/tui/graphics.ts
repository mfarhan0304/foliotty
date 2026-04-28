export type GraphicsCapability = 'iterm' | 'kitty' | 'none' | 'sixel';

export type TerminalEnvironment = Readonly<Record<string, string | undefined>>;

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.length > 0;
}

function hasSixelMarker(value: string | undefined): boolean {
  return value !== undefined && /sixel/iu.test(value);
}

function isGraphicsCapability(value: string): value is GraphicsCapability {
  return (
    value === 'iterm' ||
    value === 'kitty' ||
    value === 'sixel' ||
    value === 'none'
  );
}

export function detectGraphicsCapability(
  env: TerminalEnvironment = process.env,
): GraphicsCapability {
  const override = env.FOLIOTTY_GRAPHICS;
  if (
    override !== undefined &&
    override.length > 0 &&
    isGraphicsCapability(override)
  ) {
    return override;
  }

  if (hasValue(env.KITTY_WINDOW_ID) || env.TERM === 'xterm-kitty') {
    return 'kitty';
  }

  if (env.TERM_PROGRAM === 'iTerm.app') {
    return 'iterm';
  }

  if (
    hasSixelMarker(env.TERM) ||
    hasSixelMarker(env.TERM_PROGRAM) ||
    hasSixelMarker(env.TERMINAL_EMULATOR)
  ) {
    return 'sixel';
  }

  return 'none';
}
