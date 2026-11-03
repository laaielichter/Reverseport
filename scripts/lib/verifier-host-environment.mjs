/**
 * Variables a Windows child process needs from the host even when a verifier
 * isolates everything else. Without SystemRoot, Node aborts at startup with
 * `Assertion failed: ncrypto::CSPRNG(nullptr, 0)`; without ComSpec and PATHEXT
 * npm `.cmd` shims such as `qwen.cmd` cannot be resolved or run; without TEMP
 * and TMP, Windows falls back to C:\Windows\temp, which a normal account may
 * not open, and analysis fails at startup with "Access is denied".
 */
const WINDOWS_HOST_VARIABLES = [
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
];

/** Host variables to keep in an isolated verifier environment. */
export const verifierHostEnvironment = (
  source = process.env,
  platform = process.platform,
) => {
  if (platform !== "win32") return {};
  const kept = {};
  for (const name of WINDOWS_HOST_VARIABLES) {
    // Windows environment names are case-insensitive; Node keeps the host spelling.
    const key = Object.keys(source).find(
      (candidate) => candidate.toUpperCase() === name.toUpperCase(),
    );
    if (key !== undefined && source[key] !== undefined)
      kept[name] = source[key];
  }
  return kept;
};
