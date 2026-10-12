import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

/** True when this module is the script node was started with (works with symlinks and Windows paths). */
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try { return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(metaUrl)); }
  catch { return path.resolve(process.argv[1]) === fileURLToPath(metaUrl); }
}
