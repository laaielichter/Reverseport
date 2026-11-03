import { readFileSync, realpathSync } from "node:fs";
import { relative, isAbsolute } from "node:path";

const PERSISTED =
  /^<persisted-output>\r?\n[^\r\n]*Full output saved to: ([^\r\n]+)\r?\n/u;

/**
 * Claude Code replaces a large tool result with a `<persisted-output>` preview
 * and saves the complete result to a file. Return that file's text when it lies
 * inside `root` (the verifier's own lab), otherwise undefined.
 */
export const readPersistedToolOutput = (text, root) => {
  const saved = PERSISTED.exec(text)?.[1];
  if (saved === undefined) return undefined;
  let file;
  try {
    file = realpathSync(saved);
  } catch {
    return undefined;
  }
  const inside = relative(realpathSync(root), file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
    return undefined;
  return readFileSync(file, "utf8");
};
