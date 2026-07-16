/**
 * The data model shared with the Go diff engine.
 *
 * These types mirror the JSON that `internal/diff` emits across the WASM
 * boundary. They are hand-maintained: if a field changes in Go, it changes
 * here, and `assertResult` is what catches the mismatch at runtime rather
 * than letting a renamed field render as a blank grid.
 */

/** How a row or column relates to the two sheets. */
export type Op = "equal" | "insert" | "delete" | "move" | "modify";

/** One side of a comparison: a header row plus its data rows. */
export interface Sheet {
  header: string[];
  rows: string[][];
}

/** A parsed workbook, which may hold more than one sheet to choose from. */
export interface Workbook {
  /** Sheet names in workbook order; always at least one entry. */
  sheetNames: string[];
  /** The parsed sheet for each name, keyed by name. */
  sheets: Record<string, Sheet>;
  /** The source file's name, for display. */
  fileName: string;
}

export interface ColumnDiff {
  op: Op;
  aIndex: number;
  bIndex: number;
  name: string;
}

/**
 * One cell of the grid.
 *
 * Fields are optional because the engine omits empty ones: most cells in a
 * real diff are unchanged, and spelling that out for every cell of a large
 * sheet would bloat the payload crossing the WASM boundary. An absent
 * `value` means an empty cell; an absent `changed` means unchanged.
 */
export interface Cell {
  value?: string;
  /** The prior value; present only when `changed` is true. */
  before?: string;
  changed?: boolean;
}

export interface RowResult {
  op: Op;
  aIndex: number;
  bIndex: number;
  /** One cell per entry in `DiffResult.columns`, in the same order. */
  cells: Cell[];
}

export interface Summary {
  rowsAdded: number;
  rowsRemoved: number;
  rowsChanged: number;
  rowsMoved: number;
  rowsUnchanged: number;
  cellsChanged: number;
  columnsAdded: number;
  columnsRemoved: number;
}

export interface DiffResult {
  columns: ColumnDiff[];
  rows: RowResult[];
  summary: Summary;
}

/**
 * An error with a message written for the person using the tool, not for a
 * console. Everything that can fail at an input boundary — parsing, the
 * WASM handoff — raises one of these so the UI always has something
 * honest to show instead of a blank screen.
 */
export class RedlineError extends Error {
  /**
   * The underlying failure, kept for diagnosis. Carried explicitly rather
   * than via the standard `cause` option, which the ES2020 target predates.
   */
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RedlineError";
    this.cause = cause;
  }
}
