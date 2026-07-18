import { readFile } from "node:fs/promises";

const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MPL-2.0",
  "(MIT AND Zlib)",
  "(MIT OR GPL-3.0-or-later)",
]);

function packageName(lockPath, entry) {
  if (entry.name) return entry.name;
  const tail = lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
  const parts = tail.split("/");
  return tail.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = Object.entries(lock.packages)
  .filter(([lockPath]) => lockPath !== "")
  .map(([lockPath, entry]) => ({
    name: packageName(lockPath, entry),
    version: entry.version ?? "unknown",
    license: entry.license ?? "MISSING",
    development: Boolean(entry.dev),
    optional: Boolean(entry.optional),
    lockPath,
  }))
  .sort((left, right) => left.lockPath.localeCompare(right.lockPath));

const rejected = packages.filter((entry) => !allowedLicenses.has(entry.license));
if (rejected.length > 0) {
  console.error("Dependency license policy failed:");
  for (const entry of rejected) console.error(`- ${entry.lockPath}: ${entry.license}`);
  process.exit(1);
}

const counts = Object.fromEntries(
  [...allowedLicenses]
    .map((license) => [license, packages.filter((entry) => entry.license === license).length])
    .filter(([, count]) => count > 0),
);
const report = {
  schema: "parkworks-dependency-license-report-v1",
  rootLicense: lock.packages[""].license ?? "MISSING",
  policy: [...allowedLicenses].sort(),
  counts,
  packages,
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`Verified ${packages.length} locked dependency packages across ${Object.keys(counts).length} allowed license expressions.`);
}
