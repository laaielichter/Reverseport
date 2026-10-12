// Prints the useful part of a log as GitHub annotations (logs are not always downloadable).
// Usage: node report.mjs <name> <exitCode> <logFile>
import { readFileSync } from "node:fs";
const [name, code, file] = process.argv.slice(2);
const text = readFileSync(file, "utf8").replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
const lines = text.split("\n");
let start = lines.findIndex((l) => /Failed Tests \d+/.test(l));
if (start < 0) start = Math.max(0, lines.length - 150);
const body = lines.slice(start).filter((l) => l.trim()).join("\n");
const enc = (s) => s.replace(/%/g, "%25").replace(/\n/g, "%0A").replace(/::/g, ": :");
const size = 30000;
const chunks = [];
for (let i = 0; i < body.length && chunks.length < 9; i += size) chunks.push(body.slice(i, i + size));
console.log(`::error title=${name} exit ${code}::${enc(chunks.shift() ?? "(empty)")}`);
chunks.forEach((c, i) => console.log(`::error title=${name} part ${i + 2}::${enc(c)}`));
