/**
 * Smoke-tests the compiled WASM engine across the real JS boundary.
 *
 * The Go tests cover the engine and the vitest suite covers the frontend
 * with the engine stubbed, because jsdom cannot instantiate a 3MB WASM
 * module. That leaves one seam untested by both: the actual Go/JS handoff,
 * where a rename or a marshalling change would break the app while every
 * other test stays green. This runs the real binary and checks the wow
 * moment survives the crossing.
 *
 * Usage: npm run test:wasm (requires npm run build:wasm first).
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// wasm_exec.js is written for the browser; these are the globals Go's
// runtime reaches for that Node does not provide under ESM.
globalThis.require = createRequire(import.meta.url);
globalThis.fs = nodeFs;
globalThis.path = nodePath;

await import(join(root, "public", "wasm_exec.js"));

const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(
  await readFile(join(root, "public", "main.wasm")),
  go.importObject,
);
go.run(instance);
// go.run returns before the Go side finishes registering its exports.
await new Promise((resolve) => setTimeout(resolve, 50));

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`✗ ${name}\n    got:  ${JSON.stringify(actual)}\n    want: ${JSON.stringify(expected)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

function diff(before, after) {
  return JSON.parse(globalThis.sheetDelta.diff(JSON.stringify(before), JSON.stringify(after)));
}

// The wow moment: one cell edited, one row moved.
const before = {
  header: ["id", "name", "total"],
  rows: [
    ["1", "Ada", "100"],
    ["2", "Grace", "200"],
    ["3", "Alan", "300"],
  ],
};
const after = {
  header: ["id", "name", "total"],
  rows: [
    ["3", "Alan", "300"],
    ["1", "Ada", "100"],
    ["2", "Grace", "250"],
  ],
};

const wow = diff(before, after);
check("diff succeeds", wow.ok, true);
check("ops cross the boundary as names", wow.result.rows.map((r) => r.op), [
  "move",
  "equal",
  "modify",
]);
check("exactly one cell is flagged", wow.result.summary.cellsChanged, 1);
check("the reorder is not a change", [wow.result.summary.rowsAdded, wow.result.summary.rowsRemoved], [0, 0]);
check(
  "the changed cell carries both values",
  wow.result.rows[2].cells[2],
  { value: "250", before: "200", changed: true },
);

// Malformed input must come back as a tagged error, not a thrown panic
// that would take the WASM instance down with it.
const bad = diff("{", {});
check("invalid JSON is reported, not thrown", bad.ok, false);
check("the error explains itself", typeof bad.error === "string" && bad.error.length > 0, true);

const wrongArity = JSON.parse(globalThis.sheetDelta.diff("{}"));
check("a missing argument is reported", wrongArity.ok, false);

// A sheet big enough that an O(n*m) engine would never return.
const rows = Array.from({ length: 50_000 }, (_, i) => [String(i), `name-${i}`, String(i * 2)]);
const bigBefore = { header: ["id", "name", "total"], rows };
const bigAfter = { header: ["id", "name", "total"], rows: rows.map((r) => [...r]) };
bigAfter.rows[25_000][2] = "changed";

const start = performance.now();
const big = diff(bigBefore, bigAfter);
const elapsed = performance.now() - start;

check("50k rows diff correctly", [big.ok, big.result.summary.cellsChanged], [true, 1]);
console.log(`  50k-row diff took ${Math.round(elapsed)}ms`);

// A regression guard, not the product's performance target. Story 9 budgets
// 3s on a mid-tier laptop; this ceiling is loose enough to pass on slow,
// shared CI hardware while still catching an algorithmic regression — an
// accidental O(n*m) would blow past it by orders of magnitude, not
// percentages.
const CEILING_MS = 20_000;
if (elapsed > CEILING_MS) {
  failures++;
  console.error(`✗ 50k-row diff took ${Math.round(elapsed)}ms, ceiling is ${CEILING_MS}ms`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nwasm smoke test passed");
process.exit(0);
