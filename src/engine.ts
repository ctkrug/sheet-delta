import { RedlineError, type DiffResult, type Sheet } from "./types";

/**
 * Loads the Go diff engine (WASM) and runs comparisons through it.
 *
 * The engine is fetched relative to the document, never from an absolute
 * path, because the app is served from a subpath in production.
 */

/** The shape `wasm_exec.js` and the Go module install on `globalThis`. */
interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): void;
}

declare global {
  // eslint-disable-next-line no-var
  var Go: (new () => GoRuntime) | undefined;
  // eslint-disable-next-line no-var
  var redline: { diff(before: string, after: string): string } | undefined;
}

/** What the Go side returns: a tagged success or a message we can show. */
type EngineResponse = { ok: true; result: DiffResult } | { ok: false; error: string };

let loading: Promise<void> | undefined;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-redline="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.redline = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads and starts the WASM engine, at most once per page.
 *
 * Concurrent callers share one in-flight load; a failed load is not cached,
 * so a user who lost their connection mid-load can retry by dropping the
 * files again.
 */
export function loadEngine(): Promise<void> {
  if (globalThis.redline) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    // Relative URLs: the app is served from apps.charliekrug.com/sheet-delta/,
    // so a leading slash would resolve to the wrong origin path and 404.
    await loadScript(new URL("wasm_exec.js", document.baseURI).href);
    const Go = globalThis.Go;
    if (!Go) throw new Error("the Go WASM runtime did not initialize");

    const go = new Go();
    const wasmURL = new URL("main.wasm", document.baseURI).href;
    const response = await fetch(wasmURL);
    if (!response.ok) {
      throw new Error(`fetching the diff engine failed with HTTP ${response.status}`);
    }
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(),
      go.importObject,
    );
    // go.run resolves only when the Go program exits, which it never does —
    // main blocks so the exported function stays callable. Deliberately not
    // awaited.
    void go.run(instance);

    if (!globalThis.redline) {
      throw new Error("the diff engine did not register itself");
    }
  })().catch((cause) => {
    loading = undefined; // let the next attempt retry rather than fail forever
    throw new RedlineError(
      "The diff engine couldn't be loaded. Check your connection and try again.",
      cause,
    );
  });

  return loading;
}

/**
 * Compares two sheets, loading the engine on first use.
 *
 * @throws {RedlineError} if the engine can't load or rejects the input.
 */
export async function diffSheets(before: Sheet, after: Sheet): Promise<DiffResult> {
  await loadEngine();
  const engine = globalThis.redline;
  if (!engine) {
    throw new RedlineError("The diff engine isn't available.");
  }

  let response: EngineResponse;
  try {
    response = JSON.parse(engine.diff(JSON.stringify(before), JSON.stringify(after)));
  } catch (cause) {
    throw new RedlineError("The comparison failed unexpectedly. Try again.", cause);
  }

  if (!response.ok) {
    throw new RedlineError(`The comparison failed: ${response.error}`);
  }
  return response.result;
}
