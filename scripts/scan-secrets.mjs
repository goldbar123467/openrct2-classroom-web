import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const binaryExtensions = new Set([".gif", ".gz", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".tar", ".wasm", ".webm", ".zip"]);
const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "OpenAI key", regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: "Stripe live secret", regex: /sk_live_[A-Za-z0-9]{16,}/ },
  {
    name: "long assigned secret",
    regex: /(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/i,
  },
];

function matchesSecret(line) {
  return patterns.find(({ regex }) => regex.test(line));
}

const fileOutput = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
const files = fileOutput
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const findings = [];
let scannedFiles = 0;

for (const file of files) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  if (statSync(file).size > 8 * 1024 * 1024) continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  scannedFiles += 1;
  const lines = bytes.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const pattern = matchesSecret(line);
    if (pattern) findings.push({ scope: "tree", location: `${file}:${index + 1}`, rule: pattern.name });
  });
}

if (process.argv.includes("--history")) {
  const history = execFileSync(
    "git",
    ["log", "-p", "--all", "--no-ext-diff", "--unified=0", "--", ".", ":(exclude)public/engine/**"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let commit = "unknown";
  let file = "unknown";
  for (const line of history.split(/\r?\n/)) {
    if (line.startsWith("commit ")) commit = line.slice(7, 19);
    if (line.startsWith("+++ b/")) file = line.slice(6);
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const pattern = matchesSecret(line.slice(1));
    if (pattern) findings.push({ scope: "history", location: `${commit}:${file}`, rule: pattern.name });
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found; values are intentionally suppressed:");
  for (const finding of findings) console.error(`- ${finding.scope} ${finding.location} (${finding.rule})`);
  process.exit(1);
}

console.log(`Secret scan passed across ${scannedFiles} current text files${process.argv.includes("--history") ? " and Git history" : ""}.`);
