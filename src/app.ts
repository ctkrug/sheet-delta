import { createDropzone, type Dropzone } from "./dropzone";
import { diffSheets, loadEngine } from "./engine";
import { exportFileName, toCSV } from "./export";
import { renderGrid } from "./grid";
import { parseFile } from "./parse";
import { createSummaryBar, type SummaryBar } from "./summary";
import { RedlineError, type DiffResult, type Workbook } from "./types";

/**
 * Wires the pieces together: two files in, a grid out.
 *
 * All state lives here so the modules underneath stay pure renderers —
 * the grid draws a result, the summary bar draws counts, and neither
 * knows where the data came from.
 */

/** Which side of the comparison a file belongs to. */
type Side = "before" | "after";

/** What the main region is currently showing. */
type View = "empty" | "loading" | "diff" | "error";

interface SideState {
  workbook?: Workbook;
  /** The sheet being compared; always a key of `workbook.sheets`. */
  sheetName?: string;
  zone: Dropzone;
  picker: HTMLElement;
  /**
   * Which file this side is reading. Reading a workbook is slow enough to
   * drop another one meanwhile, and the two reads can finish in either
   * order, so each one checks it is still the current file before it lands.
   */
  load: number;
}

const SIDE_LABEL: Record<Side, string> = { before: "Before", after: "After" };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * The wordmark: a grid-cell glyph, and a red pen stroke that draws itself
 * under the name on load — the product performing its own name.
 */
function renderWordmark(): HTMLElement {
  const mark = el("div", "wordmark");
  mark.innerHTML = `
    <svg class="wordmark__glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect class="wordmark__grid" x="5" y="13" width="54" height="38" rx="2" />
      <path class="wordmark__rules" d="M5 26 H59 M23 13 V51 M41 13 V51" />
      <path class="wordmark__mark" d="M27 36 L37 28" />
    </svg>
    <span class="wordmark__text">
      Redline
      <svg class="wordmark__rule" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M2 5.5 C 28 2.5, 62 6.5, 118 3" />
      </svg>
    </span>
  `;
  return mark;
}

/**
 * The comparison shown in the empty state, as if these two sheets had been
 * dropped in:
 *
 *   before            after
 *   1  North  200     2  South  300
 *   2  South  300     1  North  250
 *   3  East   410     3  East   410
 *
 * Row 1 moved below row 2 and its total was edited — the case the tool is
 * for, and the one a text diff renders as four wrong lines. It is rendered
 * by the real grid rather than mocked up in markup, so the preview cannot
 * drift away from what the tool actually does.
 */
const SAMPLE_DIFF: DiffResult = {
  columns: [
    { op: "equal", aIndex: 0, bIndex: 0, name: "id" },
    { op: "equal", aIndex: 1, bIndex: 1, name: "region" },
    { op: "equal", aIndex: 2, bIndex: 2, name: "total" },
  ],
  rows: [
    {
      op: "equal",
      aIndex: 1,
      bIndex: 0,
      cells: [{ value: "2" }, { value: "South" }, { value: "300" }],
    },
    {
      op: "modify",
      aIndex: 0,
      bIndex: 1,
      cells: [
        { value: "1" },
        { value: "North" },
        { value: "250", before: "200", changed: true },
      ],
    },
    {
      op: "equal",
      aIndex: 2,
      bIndex: 2,
      cells: [{ value: "3" }, { value: "East" }, { value: "410" }],
    },
  ],
  summary: {
    rowsAdded: 0,
    rowsRemoved: 0,
    rowsChanged: 1,
    rowsMoved: 0,
    rowsUnchanged: 2,
    cellsChanged: 1,
    columnsAdded: 0,
    columnsRemoved: 0,
  },
};

export interface App {
  /** The app's root element, already mounted into the container. */
  readonly element: HTMLElement;
}

export function createApp(container: HTMLElement): App {
  container.replaceChildren();

  const sides = {} as Record<Side, SideState>;
  let summaryBar: SummaryBar;
  let view: View = "empty";
  /** The diff on screen, and so the one the download would write. */
  let current: DiffResult | undefined;
  /**
   * Which view currently owns the stage. Every `setView` claims it, and an
   * async comparison commits its result only if it still holds the claim it
   * took — so neither a slower earlier diff nor one superseded by an error
   * can paint over what the user is actually looking at.
   */
  let generation = 0;

  // ---- shell -------------------------------------------------------------

  const topbar = el("header", "topbar");
  const summaryHost = el("div", "topbar__summary");

  // Offered only once there is a diff to download: a dead control is a
  // worse answer than no control.
  const download = el("button", "button button--ghost topbar__download");
  download.type = "button";
  download.textContent = "Download CSV";
  download.hidden = true;
  download.addEventListener("click", () => downloadDiff());

  topbar.append(renderWordmark(), summaryHost, download);

  const main = el("main", "main");

  const setup = el("section", "setup");
  const setupZones = el("div", "setup__zones");
  setup.append(setupZones);

  const stage = el("section", "stage");
  main.append(setup, stage);

  const footer = el("footer", "footer");
  footer.innerHTML = `
    <span>Your files never leave this tab — there is no server.</span>
    <a href="https://github.com/ctkrug/sheet-delta">Source</a>
  `;

  const root = el("div", "app");
  root.append(topbar, main, footer);
  container.append(root);
  summaryBar = createSummaryBar(summaryHost);

  // ---- views -------------------------------------------------------------

  const setView = (next: View, node: HTMLElement): void => {
    generation++;
    view = next;
    stage.dataset.view = next;
    stage.replaceChildren(node);
    // The download belongs to the diff on screen; every other view has none
    // to give, so the button goes with it.
    download.hidden = next !== "diff";
  };

  const renderEmptyState = (): HTMLElement => {
    const empty = el("div", "empty");
    const copy = el("div", "empty__copy");
    copy.innerHTML = `
      <h1 class="empty__title">See what actually changed<br />between two spreadsheets</h1>
      <p class="empty__lead">
        Drop in last month's export and this month's. Sheet Delta lines the rows up by
        their content, so a row that just moved stays quiet and only the cells that
        really changed light up.
      </p>
      <ul class="empty__points">
        <li><span class="empty__bullet" aria-hidden="true">⇅</span> Reordered rows don't count as changes</li>
        <li><span class="empty__bullet" aria-hidden="true">+</span> An inserted column doesn't shift everything else</li>
        <li><span class="empty__bullet" aria-hidden="true">~</span> Changed cells are highlighted in place, in the grid</li>
      </ul>
      <p class="empty__privacy">Nothing is uploaded. The comparison runs inside this tab.</p>
    `;

    // Show the thing rather than only describing it: the same grid the tool
    // renders, on a sample where a row moved and a cell changed.
    const demo = el("figure", "empty__demo");
    const caption = el("figcaption", "empty__demo-caption");
    caption.textContent = "A sample comparison — one row moved, one cell edited";
    const preview = el("div", "grid empty__preview");
    renderGrid(preview, SAMPLE_DIFF);
    demo.append(caption, preview);

    empty.append(copy, demo);
    return empty;
  };

  const renderLoading = (): HTMLElement => {
    const loading = el("div", "loading");
    loading.setAttribute("role", "status");
    loading.innerHTML = `
      <div class="loading__rule" aria-hidden="true"><span></span><span></span><span></span></div>
      <p class="loading__text">Comparing sheets…</p>
    `;
    return loading;
  };

  const renderError = (message: string, retry: () => void): HTMLElement => {
    const panel = el("div", "errorpanel");
    panel.setAttribute("role", "alert");

    const title = el("p", "errorpanel__title");
    title.textContent = "That didn't work";

    const text = el("p", "errorpanel__text");
    text.textContent = message;

    const button = el("button", "button");
    button.type = "button";
    button.textContent = "Try again";
    button.addEventListener("click", retry);

    panel.append(title, text, button);
    return panel;
  };

  // ---- behaviour ---------------------------------------------------------

  const showError = (message: string, retry: () => void): void => {
    setView("error", renderError(message, retry));
  };

  /**
   * Writes the diff on screen out as a CSV download.
   *
   * The blob is built and revoked here rather than held: the result can be
   * tens of megabytes of text, and keeping it alive for a button that may
   * never be pressed would double the memory a large diff costs. Revoking
   * is deferred a tick because revoking during the click can cancel the
   * download in some browsers.
   */
  const downloadDiff = (): void => {
    if (!current) return;

    const blob = new Blob([toCSV(current)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(
      sides.before.workbook?.fileName ?? "before",
      sides.after.workbook?.fileName ?? "after",
    );
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /** Turns any thrown value into something worth showing a person. */
  const messageFor = (err: unknown): string =>
    err instanceof RedlineError
      ? err.message
      : "Something went wrong reading that file. Try another export.";

  const compare = async (): Promise<void> => {
    const before = sides.before;
    const after = sides.after;
    if (!before.workbook || !after.workbook || !before.sheetName || !after.sheetName) {
      // Only one file so far — keep the empty state rather than half a diff.
      if (view !== "empty") setView("empty", renderEmptyState());
      return;
    }

    setView("loading", renderLoading());
    const run = generation;

    try {
      const result = await diffSheets(
        before.workbook.sheets[before.sheetName],
        after.workbook.sheets[after.sheetName],
      );
      // A newer comparison started while this one was running; its result is
      // the one the user is waiting for.
      if (run !== generation) return;

      current = result;
      const grid = el("div", "grid");
      setView("diff", grid);
      renderGrid(grid, result);
      summaryBar.update(result.summary);
    } catch (err) {
      if (run !== generation) return;
      showError(messageFor(err), () => void compare());
    }
  };

  /** Builds the sheet picker, shown only for a workbook with a choice to make. */
  const renderPicker = (side: Side): void => {
    const state = sides[side];
    state.picker.replaceChildren();
    const workbook = state.workbook;
    if (!workbook || workbook.sheetNames.length < 2) {
      state.picker.hidden = true;
      return;
    }

    state.picker.hidden = false;
    const id = `sheet-picker-${side}`;

    const label = el("label", "picker__label");
    label.htmlFor = id;
    label.textContent = `${SIDE_LABEL[side]} sheet`;

    const select = el("select", "picker__select");
    select.id = id;
    for (const name of workbook.sheetNames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === state.sheetName;
      select.append(option);
    }
    select.addEventListener("change", () => {
      state.sheetName = select.value;
      void compare();
    });

    state.picker.append(label, select);
  };

  const loadFile = async (side: Side, file: File): Promise<void> => {
    const state = sides[side];
    const run = ++state.load;
    state.zone.setInvalid(false);

    try {
      const workbook = await parseFile(file);
      if (run !== state.load) return; // a later file replaced this one
      state.workbook = workbook;
      // Default to the first sheet, or keep the current choice if the new
      // workbook happens to have a sheet by the same name.
      state.sheetName =
        state.sheetName && workbook.sheetNames.includes(state.sheetName)
          ? state.sheetName
          : workbook.sheetNames[0];
      state.zone.setFileName(workbook.fileName);
      renderPicker(side);
      await compare();
    } catch (err) {
      // A file the user already replaced must not report its failure.
      if (run !== state.load) return;
      state.workbook = undefined;
      state.sheetName = undefined;
      state.zone.setInvalid(true);
      renderPicker(side);
      showError(messageFor(err), () => {
        state.zone.setInvalid(false);
        setView("empty", renderEmptyState());
      });
    }
  };

  for (const side of ["before", "after"] as const) {
    const picker = el("div", "picker");
    picker.hidden = true;

    const zone = createDropzone({
      label: SIDE_LABEL[side],
      onFile: (file) => void loadFile(side, file),
      onReject: (message) => {
        sides[side].zone.setInvalid(true);
        showError(message, () => {
          sides[side].zone.setInvalid(false);
          setView("empty", renderEmptyState());
        });
      },
    });

    const column = el("div", "setup__side");
    column.append(zone.element, picker);
    setupZones.append(column);

    sides[side] = { zone, picker, load: 0 };
  }

  setView("empty", renderEmptyState());

  // The engine is a couple of megabytes and the first drop shouldn't wait
  // on it. A failure here is ignored: diffSheets retries and reports.
  void loadEngine().catch(() => {});

  return { element: root };
}
