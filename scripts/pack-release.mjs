import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sourcePackage = JSON.parse(await readFile("package.json", "utf8"));
const releaseDirectory = path.resolve(".release");
const artifactDirectory = path.resolve("artifacts");

await rm(releaseDirectory, { recursive: true, force: true });
await rm(artifactDirectory, { recursive: true, force: true });
await Promise.all([
  mkdir(releaseDirectory, { recursive: true }),
  mkdir(artifactDirectory, { recursive: true }),
]);

await Promise.all([
  cp("dist", path.join(releaseDirectory, "dist"), { recursive: true }),
  cp(".skills", path.join(releaseDirectory, ".skills"), { recursive: true }),
  cp("agents", path.join(releaseDirectory, "agents"), { recursive: true }),
  cp("README.md", path.join(releaseDirectory, "README.md")),
  cp("LICENSE", path.join(releaseDirectory, "LICENSE")),
  cp("THIRD_PARTY_NOTICES.md", path.join(releaseDirectory, "THIRD_PARTY_NOTICES.md")),
]);

const releasePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  type: "module",
  bin: { "mini-agent": "dist/cli.mjs" },
  files: ["dist", ".skills", "agents", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"],
  engines: sourcePackage.engines,
  license: "MIT",
  repository: "https://github.com/codingstark-dev/mini-agent",
};
await writeFile(path.join(releaseDirectory, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`);

const { stdout } = await run("npm", ["pack", releaseDirectory, "--pack-destination", artifactDirectory, "--json"]);
const [packed] = JSON.parse(stdout);
if (!packed?.filename) throw new Error("npm did not report a packed artifact");
const archive = path.join(artifactDirectory, packed.filename);
const archiveBytes = (await stat(archive)).size;
if (archiveBytes >= 1_000_000) throw new Error("release tarball exceeds the 1 MB budget");

process.stdout.write(`${archive}\n${archiveBytes.toLocaleString()} bytes\n`);
