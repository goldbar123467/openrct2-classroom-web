import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = (await listFiles(root)).sort((left, right) => left.localeCompare(right));
const manifest = [];
for (const path of files) {
  const bytes = await readFile(path);
  manifest.push({
    path: relative(root, path).split(sep).join("/"),
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

process.stdout.write(
  `${JSON.stringify({ schema: "parkworks-dist-hashes-v1", fileCount: manifest.length, files: manifest }, null, 2)}\n`,
);
