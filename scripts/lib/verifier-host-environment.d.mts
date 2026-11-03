/** Host variables to keep in an isolated verifier environment. */
export function verifierHostEnvironment(
  source?: Readonly<Record<string, string | undefined>>,
  platform?: NodeJS.Platform,
): Record<string, string>;
