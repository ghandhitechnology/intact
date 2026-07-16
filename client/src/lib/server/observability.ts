function errorShape(error: unknown) {
  const shape: Record<string, unknown> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code)) shape.errorCode = code;
  }
  if (error instanceof Error && error.stack) {
    const frames = error.stack
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, 6);
    if (frames.length) shape.stack = frames;
  }
  return shape;
}

export function logStructuredError(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event,
    ...context,
    ...errorShape(error),
  }));
}
