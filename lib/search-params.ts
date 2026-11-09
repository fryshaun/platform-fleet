/** Normalises a Next.js query value, which may arrive repeated. */
export function readParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
