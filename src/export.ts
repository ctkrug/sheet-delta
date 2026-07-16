import type { DiffResult, Op, RowResult } from "./types";

/**
 * Turns a rendered diff into a CSV of the same grid.
 *
 * CSV rather than a screenshot or an HTML snapshot: the thing people do
 * with a diff is take it somewhere else — a ticket, a mail, a sheet of
 * their own — and every one of those reads CSV. The export mirrors what is
 * on screen rather than re-deriving anything, so what you download is what
 * you were looking at.
 */

/** How each kind of row is named in the export's first column. */
const ROW_STATUS: Record<Op, string> = {
  equal: "",
  insert: "added",
  delete: "removed",
  move: "moved",
  modify: "changed",
};

/** Separates the old and new value of a changed cell. */
const CHANGE_ARROW = " -> ";

/**
 * Quotes a field per RFC 4180.
 *
 * A spreadsheet cell can hold commas, quotes and newlines, all of which
 * would otherwise tear the row apart — the export has to survive its own
 * data. A leading BOM is not written; the file is UTF-8 and this tool
 * reads UTF-8 with or without one.
 */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The row's number in the sheet the user is looking at, as the grid shows it. */
function rowNumber(row: RowResult): number {
  const sourceIndex = row.bIndex >= 0 ? row.bIndex : row.aIndex;
  return sourceIndex + 2; // +1 for the header, +1 for 1-based
}

/**
 * Renders one cell the way the grid does: a changed cell carries both
 * values, since "250" alone would lose the very thing being exported.
 */
function cellText(cell: { value?: string; before?: string; changed?: boolean }): string {
  const value = cell.value ?? "";
  return cell.changed ? `${cell.before ?? ""}${CHANGE_ARROW}${value}` : value;
}

/** Renders a diff as CSV text, header row included. */
export function toCSV(result: DiffResult): string {
  const lines: string[] = [];
  lines.push(["Change", "Row", ...result.columns.map((c) => c.name)].map(field).join(","));

  for (const row of result.rows) {
    lines.push(
      [ROW_STATUS[row.op], String(rowNumber(row)), ...row.cells.map(cellText)]
        .map(field)
        .join(","),
    );
  }
  // A trailing newline: POSIX text, and Excel does not mind.
  return `${lines.join("\r\n")}\r\n`;
}

/** Names the download after both files, so a folder of them stays legible. */
export function exportFileName(beforeName: string, afterName: string): string {
  const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-");
  return `diff-${stem(beforeName)}-vs-${stem(afterName)}.csv`;
}
