import type { Cell, DiffResult, Op, RowResult } from "./types";

/**
 * Renders a diff as the spreadsheet grid itself, with changes marked in
 * place. This is the product: a summary count is a byproduct, but seeing
 * the familiar shape of your data with exactly the changed cells lit up is
 * the thing a text diff structurally cannot show you.
 */

/**
 * Rows rendered before the grid asks whether you really want the rest.
 *
 * Every row is a live DOM node, so a 50,000-row sheet would build 50,000 of
 * them and lock the tab for seconds. The cap is well above the 5,000-row
 * sheet the grid is expected to scroll smoothly, and the remainder is one
 * click away rather than silently dropped.
 */
export const DEFAULT_ROW_LIMIT = 5_000;

/** The gutter marker for each kind of row. */
const ROW_MARKER: Record<Op, string> = {
  equal: "",
  insert: "+",
  delete: "−",
  move: "⇅",
  modify: "~",
};

/** Screen-reader wording for each kind of row. */
const ROW_LABEL: Record<Op, string> = {
  equal: "unchanged row",
  insert: "added row",
  delete: "removed row",
  move: "moved row",
  modify: "changed row",
};

/** Screen-reader wording for each kind of column. */
const COLUMN_LABEL: Partial<Record<Op, string>> = {
  insert: "added column",
  delete: "removed column",
};

export interface GridOptions {
  /** Overrides how many rows render before the "show all" prompt. */
  rowLimit?: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Renders the row-number gutter cell, using the source sheet's numbering. */
function renderGutter(row: RowResult): HTMLTableCellElement {
  const cell = el("th", "grid__gutter");
  cell.scope = "row";

  const marker = el("span", "grid__marker");
  marker.textContent = ROW_MARKER[row.op];
  marker.setAttribute("aria-hidden", "true");

  // Number rows by where they live in the sheet the user is looking at: the
  // "after" sheet, except for removed rows, which only exist in "before".
  const sourceIndex = row.bIndex >= 0 ? row.bIndex : row.aIndex;
  const number = el("span", "grid__rownum");
  number.textContent = String(sourceIndex + 2); // +1 for the header, +1 for 1-based

  cell.append(marker, number);
  cell.setAttribute("aria-label", `${ROW_LABEL[row.op]} ${sourceIndex + 2}`);
  return cell;
}

function renderCell(cell: Cell, columnOp: Op): HTMLTableCellElement {
  const node = el("td", "grid__cell");
  if (columnOp === "insert" || columnOp === "delete") {
    node.classList.add(`grid__cell--col-${columnOp}`);
  }

  if (cell.changed) {
    node.classList.add("grid__cell--changed");
    const before = el("span", "grid__was");
    before.textContent = cell.before ?? "";
    const after = el("span", "grid__now");
    after.textContent = cell.value ?? "";
    node.append(before, after);
    // The old value is visible, but spell the change out for a screen
    // reader rather than leaving two bare values side by side.
    node.setAttribute("aria-label", `changed from ${cell.before || "empty"} to ${cell.value || "empty"}`);
    node.title = `was: ${cell.before || "(empty)"}`;
  } else {
    node.textContent = cell.value ?? "";
  }
  return node;
}

function renderRow(row: RowResult, columns: DiffResult["columns"]): HTMLTableRowElement {
  const tr = el("tr", `grid__row grid__row--${row.op}`);
  tr.append(renderGutter(row));
  for (const [i, cell] of row.cells.entries()) {
    tr.append(renderCell(cell, columns[i]?.op ?? "equal"));
  }
  return tr;
}

function renderHead(result: DiffResult): HTMLTableSectionElement {
  const thead = el("thead", "grid__head");
  const tr = el("tr");

  const corner = el("th", "grid__gutter grid__gutter--corner");
  corner.scope = "col";
  corner.textContent = "#";
  tr.append(corner);

  for (const column of result.columns) {
    const th = el("th", `grid__col grid__col--${column.op}`);
    th.scope = "col";
    th.textContent = column.name;
    const label = COLUMN_LABEL[column.op];
    if (label) {
      th.title = `${column.name} — ${label}`;
      th.setAttribute("aria-label", `${column.name}, ${label}`);
    }
    tr.append(th);
  }

  thead.append(tr);
  return thead;
}

/**
 * Renders the diff grid into `container`, replacing whatever was there.
 *
 * The container owns its own scroll region so a wide sheet scrolls inside
 * the grid instead of pushing the page sideways, and the header stays
 * pinned to the top of that region.
 */
export function renderGrid(
  container: HTMLElement,
  result: DiffResult,
  options: GridOptions = {},
): void {
  const limit = options.rowLimit ?? DEFAULT_ROW_LIMIT;
  container.replaceChildren();

  if (result.rows.length === 0) {
    container.append(renderEmptyDiff());
    return;
  }

  const scroller = el("div", "grid__scroll");
  const table = el("table", "grid__table");
  table.append(renderHead(result));

  const tbody = el("tbody");
  const shown = Math.min(result.rows.length, limit);
  // One fragment, one reflow: appending rows one at a time to a live table
  // is what makes a big grid feel like a hang.
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < shown; i++) {
    fragment.append(renderRow(result.rows[i], result.columns));
  }
  tbody.append(fragment);
  table.append(tbody);
  scroller.append(table);
  container.append(scroller);

  if (shown < result.rows.length) {
    container.append(renderRowLimitNotice(result, shown, tbody));
  }
}

/** The "showing N of M" prompt — never a silent truncation. */
function renderRowLimitNotice(
  result: DiffResult,
  shown: number,
  tbody: HTMLTableSectionElement,
): HTMLElement {
  const notice = el("div", "grid__notice");
  const text = el("p", "grid__notice-text");
  text.textContent = `Showing the first ${shown.toLocaleString()} of ${result.rows.length.toLocaleString()} rows.`;

  const button = el("button", "button button--ghost");
  button.type = "button";
  button.textContent = "Show all rows";
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Rendering…";
    // Yield first so the disabled state paints before the main thread goes
    // away to build tens of thousands of rows.
    requestAnimationFrame(() => {
      const fragment = document.createDocumentFragment();
      for (let i = shown; i < result.rows.length; i++) {
        fragment.append(renderRow(result.rows[i], result.columns));
      }
      tbody.append(fragment);
      notice.remove();
    });
  });

  notice.append(text, button);
  return notice;
}

function renderEmptyDiff(): HTMLElement {
  const empty = el("div", "grid__empty");
  const title = el("p", "grid__empty-title");
  title.textContent = "Both sheets are empty";
  const hint = el("p", "grid__empty-hint");
  hint.textContent = "There are no rows to compare.";
  empty.append(title, hint);
  return empty;
}
