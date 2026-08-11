import { readdir, stat } from "node:fs/promises";
import path from "node:path";

async function bytesIn(target) {
  const details = await stat(target);
  if (details.isFile()) return details.size;
  const entries = await readdir(target);
  return (await Promise.all(entries.map((entry) => bytesIn(path.join(target, entry))))).reduce(
    (total, size) => total + size,
    0,
  );
}

const liteBytes = await bytesIn("dist/lite.mjs");
const fullBytes =
  (await bytesIn("dist")) - liteBytes + (await bytesIn(".skills")) + (await bytesIn("THIRD_PARTY_NOTICES.md"));

process.stdout.write(`lite bundle: ${liteBytes.toLocaleString()} bytes\n`);
process.stdout.write(`full package code and data: ${fullBytes.toLocaleString()} bytes\n`);

if (liteBytes >= 1_000_000) throw new Error("lite bundle exceeds the 1 MB budget");
if (fullBytes >= 5_000_000) throw new Error("full package exceeds the 5 MB budget");
