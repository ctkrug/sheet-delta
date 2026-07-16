import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffResult, Sheet } from "./types";

/**
 * The engine loader is the app's only network-facing code, and every one of
 * its failure paths is a state a real user reaches: a dropped connection, a
 * half-deployed site, a stale cache. The app tests stub this module out and
 * the smoke tests only exercise the happy path through a real browser, so
 * the error handling is tested here, against a faked WASM environment.
 */

/** The pieces of the WASM world engine.ts reaches for. */
interface Fakes {
  /** Resolves the injected <script> tag, as a real browser would. */
  script: "load" | "error";
  /** What fetching main.wasm does. */
  wasm: "ok" | "404" | "offline";
  /** Whether the Go runtime registers redline when run. */
  registers: boolean;
  /** Whether globalThis.Go exists after the script loads. */
  runtime: boolean;
}

const defaults: Fakes = { script: "load", wasm: "ok", registers: true, runtime: true };

function sheet(...rows: string[][]): Sheet {
  return { header: ["id"], rows };
}

const result: DiffResult = {
  columns: [{ op: "equal", aIndex: 0, bIndex: 0, name: "id" }],
  rows: [],
  summary: {
    rowsAdded: 0,
    rowsRemoved: 0,
    rowsChanged: 0,
    rowsMoved: 0,
    rowsUnchanged: 0,
    cellsChanged: 0,
    columnsAdded: 0,
    columnsRemoved: 0,
  },
};

let diffImpl: () => string;

/**
 * Installs the fake WASM world and returns a freshly imported engine.
 *
 * The module caches its in-flight load in module scope, so each test needs
 * its own copy — otherwise a test that failed a load would poison the next.
 */
async function loadModule(overrides: Partial<Fakes> = {}) {
  const fakes = { ...defaults, ...overrides };
  vi.resetModules();
  document.head.replaceChildren();
  delete globalThis.Go;
  delete globalThis.redline;

  // jsdom does not fetch script src, so stand in for the browser and fire
  // the callback engine.ts is waiting on.
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    const script = node as unknown as HTMLScriptElement;
    const added = append(node);
    if (script.tagName === "SCRIPT") {
      queueMicrotask(() => {
        if (fakes.script === "load") {
          if (fakes.runtime) {
            globalThis.Go = class {
              importObject = {};
              run(): void {
                if (fakes.registers) {
                  globalThis.redline = { diff: () => diffImpl() };
                }
              }
            } as never;
          }
          script.onload?.(new Event("load"));
        } else {
          script.onerror?.(new Event("error"));
        }
      });
    }
    return added;
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (fakes.wasm === "offline") throw new TypeError("Failed to fetch");
      if (fakes.wasm === "404") return { ok: false, status: 404 };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    }),
  );
  vi.stubGlobal("WebAssembly", { instantiate: async () => ({ instance: {} }) });

  return import("./engine");
}

beforeEach(() => {
  diffImpl = () => JSON.stringify({ ok: true, result });
  return () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
});

describe("diffSheets", () => {
  it("returns the decoded result from the engine", async () => {
    const { diffSheets } = await loadModule();

    await expect(diffSheets(sheet(["1"]), sheet(["2"]))).resolves.toEqual(result);
  });

  it("passes both sheets across as JSON, in before/after order", async () => {
    const seen: string[] = [];
    const { diffSheets } = await loadModule();
    await diffSheets(sheet(["1"]), sheet(["2"]));
    // Re-register a spying diff now that the engine has loaded.
    globalThis.redline = {
      diff: (before: string, after: string) => {
        seen.push(before, after);
        return JSON.stringify({ ok: true, result });
      },
    };

    await diffSheets(sheet(["before"]), sheet(["after"]));

    expect(JSON.parse(seen[0]).rows[0][0]).toBe("before");
    expect(JSON.parse(seen[1]).rows[0][0]).toBe("after");
  });

  it("loads the engine only once across concurrent comparisons", async () => {
    const { diffSheets } = await loadModule();

    await Promise.all([
      diffSheets(sheet(["1"]), sheet(["2"])),
      diffSheets(sheet(["1"]), sheet(["2"])),
      diffSheets(sheet(["1"]), sheet(["2"])),
    ]);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  // The engine reports a bad sheet as a tagged value rather than throwing,
  // because a Go panic across the boundary would take the page with it.
  it("surfaces an error the engine reports", async () => {
    diffImpl = () => JSON.stringify({ ok: false, error: "invalid before-sheet JSON" });
    const { diffSheets } = await loadModule();

    await expect(diffSheets(sheet(["1"]), sheet(["2"]))).rejects.toThrow(
      /invalid before-sheet JSON/,
    );
  });

  it("reports a human message when the engine returns nonsense", async () => {
    diffImpl = () => "not json at all";
    const { diffSheets } = await loadModule();

    await expect(diffSheets(sheet(["1"]), sheet(["2"]))).rejects.toThrow(
      /comparison failed unexpectedly/i,
    );
  });
});

describe("loadEngine — failure paths", () => {
  // Story 14 / the offline case: the message has to name something the user
  // can act on, not leak a fetch error.
  it("explains an offline load rather than leaking the cause", async () => {
    const { loadEngine } = await loadModule({ wasm: "offline" });

    await expect(loadEngine()).rejects.toThrow(/couldn't be loaded.*connection/i);
  });

  it("reports a missing wasm binary", async () => {
    const { loadEngine } = await loadModule({ wasm: "404" });

    await expect(loadEngine()).rejects.toThrow(/couldn't be loaded/i);
  });

  it("reports a runtime script that fails to load", async () => {
    const { loadEngine } = await loadModule({ script: "error" });

    await expect(loadEngine()).rejects.toThrow(/couldn't be loaded/i);
  });

  it("reports a runtime that never initializes", async () => {
    const { loadEngine } = await loadModule({ runtime: false });

    await expect(loadEngine()).rejects.toThrow(/couldn't be loaded/i);
  });

  it("reports an engine that does not register itself", async () => {
    const { loadEngine } = await loadModule({ registers: false });

    await expect(loadEngine()).rejects.toThrow(/couldn't be loaded/i);
  });

  // A failed load must not be cached, or a user who lost their connection
  // for one second would have to reload the page to ever diff anything.
  it("retries after a failed load instead of failing forever", async () => {
    const { loadEngine } = await loadModule({ wasm: "offline" });
    await expect(loadEngine()).rejects.toThrow();

    // The connection comes back.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    await expect(loadEngine()).resolves.toBeUndefined();
    expect(globalThis.redline).toBeDefined();
  });

  it("resolves immediately once the engine is already up", async () => {
    const { loadEngine } = await loadModule();
    await loadEngine();

    await loadEngine();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
