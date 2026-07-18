import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const enginePath = resolve("public/engine/openrct2.js");
let source = await readFile(enginePath, "utf8");

const workerNeedles = ["var pthreadPoolSize=120;", "var pthreadPoolSize=4;"];
const workerReplacement = 'var pthreadPoolSize=Math.min(4,Math.max(1,Number(Module["PTHREAD_POOL_SIZE"])||2));';
const memoryNeedle = 'var INITIAL_MEMORY=Module["INITIAL_MEMORY"]||2147483648;';
const memoryReplacement = 'var INITIAL_MEMORY=Module["INITIAL_MEMORY"]||536870912;';
const errnoNeedle = 'ErrnoError:class{name="ErrnoError";constructor(errno){this.errno=errno}}';
const errnoReplacement = 'ErrnoError:class{name="ErrnoError";constructor(errno){this.errno=errno;this.stack=(new Error).stack}}';

const workerNeedle = workerNeedles.find((needle) => source.includes(needle));
if (workerNeedle) source = source.replace(workerNeedle, workerReplacement);
else if (!source.includes(workerReplacement)) throw new Error("Expected upstream pthread pool marker was not found.");

if (source.includes(memoryNeedle)) source = source.replace(memoryNeedle, memoryReplacement);
else if (!source.includes(memoryReplacement)) throw new Error("Expected upstream initial-memory marker was not found.");

if (source.includes(errnoNeedle)) source = source.replace(errnoNeedle, errnoReplacement);
else if (!source.includes(errnoReplacement)) throw new Error("Expected Emscripten filesystem error marker was not found.");

await writeFile(enginePath, source);
console.log("Patched OpenRCT2 for a 1–4 worker classroom pool and a 512 MiB defensive memory default.");
