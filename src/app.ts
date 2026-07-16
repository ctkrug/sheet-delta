import { createDropzone, type Dropzone } from "./dropzone";
import { diffSheets, loadEngine } from "./engine";
import { renderGrid } from "./grid";
import { parseFile } from "./parse";
import { createSummaryBar, type SummaryBar } from "./summary";
import { SheetDeltaError, type Workbook } from "./types";

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

/** The wordmark: a hand-drawn delta that traces itself in on load. */
function renderWordmark(): HTMLElement {
  const mark = el("div", "wordmark");
  mark.innerHTML = `
    <svg class="wordmark__glyph" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M32 12 L52 50 L12 50 Z" />
    </svg>
    <span class="wordmark__text">Sheet<span class="wordmark__accent">Delta</span></span>
  `;
  return mark;
}

export interface App {
  /** The app's root element, already mounted into the container. */
  readonly element: HTMLElement;
}

export function createApp(container: HTMLElement): App {
  container.replaceChildren();

  const sides = {} as Record<Side, SideState>;
  let summaryBar: SummaryBar;
  let view: View = "empty";
  /** Guards against an earlier, slower diff overwriting a later one. */
  let generation = 0;

  // ---- shell -------------------------------------------------------------

  const topbar = el("header", "topbar");
  const summaryHost = el("div", "topbar__summary");
  topbar.append(renderWordmark(), summaryHost);

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
    view = next;
    stage.dataset.view = next;
    stage.replaceChildren(node);
  };

  const renderEmptyState = (): HTMLElement => {
    const empty = el("div", "empty");
    empty.innerHTML = `
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

  /** Turns any thrown value into something worth showing a person. */
  const messageFor = (err: unknown): string =>
    err instanceof SheetDeltaError
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

    const run = ++generation;
    setView("loading", renderLoading());

    try {
      const result = await diffSheets(
        before.workbook.sheets[before.sheetName],
        after.workbook.sheets[after.sheetName],
      );
      // A newer comparison started while this one was running; its result is
      // the one the user is waiting for.
      if (run !== generation) return;

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
    state.zone.setInvalid(false);

    try {
      const workbook = await parseFile(file);
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

    sides[side] = { zone, picker };
  }

  setView("empty", renderEmptyState());

  // The engine is a couple of megabytes and the first drop shouldn't wait
  // on it. A failure here is ignored: diffSheets retries and reports.
  void loadEngine().catch(() => {});

  return { element: root };
}
