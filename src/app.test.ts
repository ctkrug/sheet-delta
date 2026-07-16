import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// The real engine fetches and instantiates a 3MB WASM binary, which jsdom
// cannot do. The Go engine is thoroughly tested on its own side; what
// needs proving here is the wiring — that files reach it and results reach
// the DOM — so it is stubbed with a controllable fake.
const diffSheets = vi.hoisted(() => vi.fn());
const loadEngine = vi.hoisted(() => vi.fn());
vi.mock("./engine", () => ({ diffSheets, loadEngine }));

// Parsing stays real — the point is that actual files reach the engine —
// but a file named "slow.*" takes its time, so a test can drop a second
// file while the first is still being read. A 60MB workbook really does
// take long enough for that to happen.
vi.mock("./parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse")>();
  return {
    ...actual,
    parseFile: async (file: File) => {
      const workbook = await actual.parseFile(file);
      if (file.name.startsWith("slow")) await new Promise((r) => setTimeout(r, 60));
      return workbook;
    },
  };
});

const { createApp } = await import("./app");
const { RedlineError } = await import("./types");
import type { DiffResult, Summary } from "./types";

function summaryOf(overrides: Partial<Summary> = {}): Summary {
  return {
    rowsAdded: 0,
    rowsRemoved: 0,
    rowsChanged: 0,
    rowsMoved: 0,
    rowsUnchanged: 0,
    cellsChanged: 0,
    columnsAdded: 0,
    columnsRemoved: 0,
    ...overrides,
  };
}

/** A one-cell-changed result, the shape the app renders most often. */
function changedResult(): DiffResult {
  return {
    columns: [
      { op: "equal", aIndex: 0, bIndex: 0, name: "id" },
      { op: "equal", aIndex: 1, bIndex: 1, name: "total" },
    ],
    rows: [
      {
        op: "modify",
        aIndex: 0,
        bIndex: 0,
        cells: [
          { value: "1", changed: false },
          { value: "250", before: "200", changed: true },
        ],
      },
    ],
    summary: summaryOf({ rowsChanged: 1, cellsChanged: 1 }),
  };
}

function csvFile(name: string, body: string): File {
  return new File([body], name);
}

function xlsxFile(name: string, sheets: Record<string, string[][]>): File {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], name);
}

function dropOn(zone: Element, file: File): void {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  zone.dispatchEvent(event);
}

/**
 * Lets the parse → diff → render chain settle.
 *
 * Reading a file goes through FileReader, which resolves on a macrotask, so
 * draining microtasks alone is not enough to see the result of a drop.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let container: HTMLElement;

const zones = () => [...container.querySelectorAll(".dropzone")];
const stageView = () => container.querySelector<HTMLElement>(".stage")!.dataset.view;

/** Drops a valid before/after pair and waits for the diff to render. */
async function dropPair(
  before = csvFile("before.csv", "id,total\n1,200\n"),
  after = csvFile("after.csv", "id,total\n1,250\n"),
): Promise<void> {
  dropOn(zones()[0], before);
  await flush();
  dropOn(zones()[1], after);
  await flush();
}

beforeEach(() => {
  diffSheets.mockReset();
  diffSheets.mockResolvedValue(changedResult());
  loadEngine.mockReset();
  loadEngine.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.replaceChildren(container);
  createApp(container);
});

describe("createApp — shell", () => {
  it("renders the wordmark, both drop zones, and the summary bar", () => {
    expect(container.querySelector(".wordmark")?.textContent).toContain("Redline");
    expect(zones()).toHaveLength(2);
    expect(container.querySelector(".summary")).not.toBeNull();
  });

  // Story 13: the empty state has to sell the tool before any file lands.
  it("opens on an empty state that explains the value", () => {
    expect(stageView()).toBe("empty");
    const empty = container.querySelector(".empty")!;
    expect(empty.textContent).toMatch(/changed/i);
    expect(empty.textContent).toMatch(/moved|reordered/i);
    expect(empty.textContent).toMatch(/nothing is uploaded/i);
  });

  it("labels the zones Before and After", () => {
    const labels = [...container.querySelectorAll(".dropzone__label")].map((l) => l.textContent);
    expect(labels).toEqual(["Before", "After"]);
  });
});

describe("createApp — comparing", () => {
  it("waits for both files before comparing", async () => {
    dropOn(zones()[0], csvFile("before.csv", "id,total\n1,200\n"));
    await flush();

    expect(diffSheets).not.toHaveBeenCalled();
    expect(stageView()).toBe("empty");
  });

  // The wow moment, end to end: two files in, a grid with one highlighted
  // cell out.
  it("renders the grid once both files are in", async () => {
    await dropPair();

    expect(stageView()).toBe("diff");
    expect(container.querySelectorAll(".grid__cell--changed")).toHaveLength(1);
    expect(container.querySelector(".grid__cell--changed")?.textContent).toContain("250");
  });

  it("passes the parsed sheets to the engine in before/after order", async () => {
    await dropPair();

    expect(diffSheets).toHaveBeenCalledOnce();
    const [before, after] = diffSheets.mock.calls[0];
    expect(before.rows).toEqual([["1", "200"]]);
    expect(after.rows).toEqual([["1", "250"]]);
  });

  it("shows the chosen file names on their zones", async () => {
    await dropPair();

    expect(zones()[0].textContent).toContain("before.csv");
    expect(zones()[1].textContent).toContain("after.csv");
  });

  it("updates the summary counts from the result", async () => {
    await dropPair();

    const live = container.querySelector("[role='status'][aria-live]");
    expect(live?.textContent).toContain("1 cell changed");
  });

  // Story 6: a new pair re-diffs in place, with no reload.
  it("re-compares when a replacement file is dropped", async () => {
    await dropPair();
    diffSheets.mockResolvedValue({ ...changedResult(), summary: summaryOf({ rowsAdded: 7 }) });

    dropOn(zones()[1], csvFile("after2.csv", "id,total\n1,999\n"));
    await flush();

    expect(diffSheets).toHaveBeenCalledTimes(2);
    expect(diffSheets.mock.calls[1][1].rows).toEqual([["1", "999"]]);
    expect(zones()[1].textContent).toContain("after2.csv");
  });

  // Story 14: a slow comparison shows a loading state, not a frozen page.
  it("shows a loading state while the comparison runs", async () => {
    let release!: (r: DiffResult) => void;
    diffSheets.mockReturnValue(new Promise<DiffResult>((resolve) => (release = resolve)));

    await dropPair();
    expect(stageView()).toBe("loading");
    expect(container.querySelector(".loading")?.getAttribute("role")).toBe("status");

    release(changedResult());
    await flush();
    expect(stageView()).toBe("diff");
  });

  // A slow first diff must not land on top of a faster second one.
  it("ignores a superseded comparison's result", async () => {
    const slow = changedResult();
    slow.rows[0].cells[1].value = "STALE";
    let releaseSlow!: (r: DiffResult) => void;
    diffSheets.mockReturnValueOnce(new Promise<DiffResult>((resolve) => (releaseSlow = resolve)));

    await dropPair();
    expect(stageView()).toBe("loading");

    // A second pair lands and resolves while the first is still pending.
    diffSheets.mockResolvedValue(changedResult());
    dropOn(zones()[1], csvFile("after2.csv", "id,total\n1,250\n"));
    await flush();
    releaseSlow(slow);
    await flush();

    expect(container.textContent).not.toContain("STALE");
    expect(container.querySelector(".grid__cell--changed")?.textContent).toContain("250");
  });
});

describe("createApp — sheet picker", () => {
  const pickers = () => [...container.querySelectorAll<HTMLElement>(".picker")];

  it("stays hidden for a single-sheet file", async () => {
    await dropPair();

    expect(pickers().every((p) => p.hidden)).toBe(true);
  });

  // Story 3: a multi-sheet workbook lets the user pick, defaulting to the
  // first sheet.
  it("offers every sheet of a multi-sheet workbook, defaulting to the first", async () => {
    dropOn(zones()[0], xlsxFile("multi.xlsx", { Jan: [["id"], ["1"]], Feb: [["id"], ["2"]] }));
    await flush();

    expect(pickers()[0].hidden).toBe(false);
    const select = pickers()[0].querySelector("select")!;
    expect([...select.options].map((o) => o.value)).toEqual(["Jan", "Feb"]);
    expect(select.value).toBe("Jan");
  });

  it("re-compares with the newly chosen sheet", async () => {
    dropOn(zones()[0], xlsxFile("multi.xlsx", { Jan: [["id"], ["1"]], Feb: [["id"], ["2"]] }));
    await flush();
    dropOn(zones()[1], csvFile("after.csv", "id\n9\n"));
    await flush();
    expect(diffSheets.mock.calls[0][0].rows).toEqual([["1"]]);

    const select = pickers()[0].querySelector("select")!;
    select.value = "Feb";
    select.dispatchEvent(new Event("change"));
    await flush();

    expect(diffSheets).toHaveBeenCalledTimes(2);
    expect(diffSheets.mock.calls[1][0].rows).toEqual([["2"]]);
  });

  it("has a label tied to its select", async () => {
    dropOn(zones()[0], xlsxFile("multi.xlsx", { Jan: [["id"], ["1"]], Feb: [["id"], ["2"]] }));
    await flush();

    const label = pickers()[0].querySelector("label")!;
    const select = pickers()[0].querySelector("select")!;
    expect(label.htmlFor).toBe(select.id);
    expect(select.id).not.toBe("");
  });
});

describe("createApp — download", () => {
  const button = () => container.querySelector<HTMLButtonElement>(".topbar__download")!;

  it("offers no download until there is a diff to download", () => {
    expect(button().hidden).toBe(true);
  });

  it("offers the download once the grid is up", async () => {
    await dropPair();

    expect(button().hidden).toBe(false);
  });

  it("withdraws the download when the diff leaves the screen", async () => {
    await dropPair();
    diffSheets.mockRejectedValueOnce(new RedlineError("nope"));
    dropOn(zones()[1], csvFile("after2.csv", "id,total\n1,999\n"));
    await flush();

    expect(stageView()).toBe("error");
    expect(button().hidden).toBe(true);
  });

  // Story 12: what downloads must be the diff that is on screen.
  it("writes the diff on screen, named after both files", async () => {
    const clicked: { href: string; download: string }[] = [];
    const created: string[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push("blob:fake");
        blobs.set("blob:fake", blob);
        return "blob:fake";
      },
      revokeObjectURL: (url: string) => created.splice(created.indexOf(url), 1),
    });
    const blobs = new Map<string, Blob>();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });

    await dropPair(
      csvFile("q1.csv", "id,total\n1,200\n"),
      csvFile("q2.csv", "id,total\n1,250\n"),
    );
    button().click();

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("diff-q1-vs-q2.csv");
    // jsdom's Blob has no text(); arrayBuffer is polyfilled in test-setup.
    const text = new TextDecoder().decode(await blobs.get("blob:fake")!.arrayBuffer());
    expect(text).toContain("Change,Row,id,total");
    expect(text).toContain("200 -> 250");

    // The object URL is revoked on a later tick, so let it happen while the
    // stub is still installed: jsdom has no object URLs of its own to fall
    // back on, and a leaked blob URL pins its blob in memory for the life of
    // the document.
    await flush();
    expect(created).toEqual([]);

    vi.unstubAllGlobals();
  });
});

describe("createApp — error states", () => {
  // Story 14: errors are designed states with a retry, never a blank screen
  // or a console stack trace.
  it("shows a designed error with a retry when a file cannot be parsed", async () => {
    dropOn(zones()[0], csvFile("broken.xlsx", "PK\u0003\u0004 not really a workbook"));
    await flush();

    expect(stageView()).toBe("error");
    const panel = container.querySelector(".errorpanel")!;
    expect(panel.getAttribute("role")).toBe("alert");
    expect(panel.textContent).toContain("broken.xlsx");
    expect(panel.querySelector("button")?.textContent).toBe("Try again");
    expect(zones()[0].classList.contains("dropzone--invalid")).toBe(true);
  });

  it("returns to the empty state when the error is dismissed", async () => {
    dropOn(zones()[0], csvFile("broken.xlsx", "PK\u0003\u0004 not really a workbook"));
    await flush();

    container.querySelector<HTMLButtonElement>(".errorpanel button")!.click();
    await flush();

    expect(stageView()).toBe("empty");
    expect(zones()[0].classList.contains("dropzone--invalid")).toBe(false);
  });

  // Story 7: an unsupported file names what would work instead.
  it("names the accepted formats when given an unsupported file", async () => {
    dropOn(zones()[0], new File(["x"], "chart.png"));
    await flush();

    expect(stageView()).toBe("error");
    const text = container.querySelector(".errorpanel__text")!.textContent!;
    expect(text).toContain("chart.png");
    expect(text).toContain(".csv");
    expect(diffSheets).not.toHaveBeenCalled();
  });

  it("surfaces an engine failure and retries on request", async () => {
    diffSheets.mockRejectedValueOnce(new RedlineError("The diff engine couldn't be loaded."));

    await dropPair();
    expect(stageView()).toBe("error");
    expect(container.querySelector(".errorpanel__text")?.textContent).toContain("engine");

    diffSheets.mockResolvedValue(changedResult());
    container.querySelector<HTMLButtonElement>(".errorpanel button")!.click();
    await flush();

    expect(stageView()).toBe("diff");
  });

  // A diff of two big sheets runs for seconds, which is plenty of time to
  // drop a third file. If the comparison it started before the error lands
  // afterwards, it silently replaces the error panel with a grid — the user
  // is told nothing about the file they just dropped and is left reading a
  // diff of files that are no longer both loaded.
  it("keeps the error when a comparison it superseded lands late", async () => {
    let releaseSlow!: (r: DiffResult) => void;
    diffSheets.mockReturnValueOnce(new Promise<DiffResult>((resolve) => (releaseSlow = resolve)));

    await dropPair();
    expect(stageView()).toBe("loading");

    dropOn(zones()[1], new File(["x"], "chart.png"));
    await flush();
    expect(stageView()).toBe("error");

    releaseSlow(changedResult());
    await flush();

    expect(stageView()).toBe("error");
    expect(container.querySelector(".errorpanel__text")?.textContent).toContain("chart.png");
  });

  // Dropping the wrong file and immediately dropping the right one is an
  // ordinary correction. If the slower first read lands last it wins, and
  // the user is shown a diff of a file they already replaced.
  it("keeps the last file dropped on a zone, not the slowest", async () => {
    dropOn(zones()[0], csvFile("slow-wrong.csv", "id,total\n1,111\n"));
    dropOn(zones()[0], csvFile("right.csv", "id,total\n1,200\n"));
    await flush();
    dropOn(zones()[1], csvFile("after.csv", "id,total\n1,250\n"));
    await flush();

    expect(zones()[0].textContent).toContain("right.csv");
    expect(zones()[0].textContent).not.toContain("slow-wrong.csv");
    // The engine must be comparing the file the zone claims to hold.
    const calls = diffSheets.mock.calls;
    const [before] = calls[calls.length - 1];
    expect(before.rows).toEqual([["1", "200"]]);
  });

  // An unexpected internal error must still read as a designed state, not
  // leak a stack trace at the user.
  it("shows a human message for an unexpected failure", async () => {
    diffSheets.mockRejectedValue(new TypeError("undefined is not a function"));

    await dropPair();

    expect(stageView()).toBe("error");
    const text = container.querySelector(".errorpanel__text")!.textContent!;
    expect(text).not.toContain("undefined is not a function");
    expect(text.length).toBeGreaterThan(10);
  });
});
