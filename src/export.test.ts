import { describe, expect, it } from "vitest";
import { exportFileName, toCSV } from "./export";
import type { Cell, ColumnDiff, DiffResult, Op, RowResult } from "./types";

function column(name: string, op: Op = "equal"): ColumnDiff {
  return { name, op, aIndex: 0, bIndex: 0 };
}

function row(op: Op, cells: Cell[], aIndex = 0, bIndex = 0): RowResult {
  return { op, aIndex, bIndex, cells };
}

function result(columns: ColumnDiff[], rows: RowResult[]): DiffResult {
  return {
    columns,
    rows,
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
}

/**
 * Splits off the trailing newline without trimming, so a field ending in a
 * meaningful space (a change to empty renders as "was -> ") stays intact.
 */
const lines = (csv: string) => csv.split("\r\n").slice(0, -1);

describe("toCSV", () => {
  it("writes a header of the status, the row number, and the columns", () => {
    const csv = toCSV(result([column("id"), column("total")], []));

    expect(lines(csv)).toEqual(["Change,Row,id,total"]);
  });

  // Story 12: the export has to reflect the changed cells that were on
  // screen — a bare "250" would lose the very thing being exported.
  it("carries both values of a changed cell", () => {
    const csv = toCSV(
      result(
        [column("id"), column("total")],
        [row("modify", [{ value: "1" }, { value: "250", before: "200", changed: true }])],
      ),
    );

    expect(lines(csv)[1]).toBe("changed,2,1,200 -> 250");
  });

  it("names each kind of row", () => {
    const csv = toCSV(
      result(
        [column("id")],
        [
          row("equal", [{ value: "a" }]),
          row("insert", [{ value: "b" }], -1, 1),
          row("delete", [{ value: "c" }], 2, -1),
          row("move", [{ value: "d" }], 3, 3),
          row("modify", [{ value: "e" }], 4, 4),
        ],
      ),
    );

    expect(lines(csv).slice(1).map((l) => l.split(",")[0])).toEqual([
      "",
      "added",
      "removed",
      "moved",
      "changed",
    ]);
  });

  // A removed row exists only in the "before" sheet, so it is numbered from
  // there — the same rule the grid's gutter uses.
  it("numbers rows the way the grid does", () => {
    const csv = toCSV(
      result(
        [column("id")],
        [row("insert", [{ value: "new" }], -1, 0), row("delete", [{ value: "gone" }], 4, -1)],
      ),
    );

    expect(lines(csv).slice(1).map((l) => l.split(",")[1])).toEqual(["2", "6"]);
  });

  // The export has to survive its own data: a sheet cell can hold commas,
  // quotes and newlines, any of which would otherwise tear the row apart.
  it("quotes fields containing commas, quotes or newlines", () => {
    const csv = toCSV(
      result(
        [column("note")],
        [
          row("equal", [{ value: "a,b" }]),
          row("equal", [{ value: 'say "hi"' }]),
          row("equal", [{ value: "line1\nline2" }]),
        ],
      ),
    );

    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("quotes a column name that would break the header", () => {
    const csv = toCSV(result([column("total, net")], []));

    expect(lines(csv)[0]).toBe('Change,Row,"total, net"');
  });

  // The engine omits empty fields, so cells arrive bare.
  it("writes an empty cell for a cell the engine sent as empty", () => {
    const csv = toCSV(result([column("a"), column("b")], [row("equal", [{}, { value: "x" }])]));

    expect(lines(csv)[1]).toBe(",2,,x");
  });

  it("renders a change from empty and a change to empty", () => {
    const csv = toCSV(
      result(
        [column("a"), column("b")],
        [row("modify", [{ value: "now", changed: true }, { before: "was", changed: true }])],
      ),
    );

    expect(lines(csv)[1]).toBe("changed,2, -> now,was -> ");
  });

  it("round-trips through a CSV parser as the grid's shape", async () => {
    const XLSX = await import("xlsx");
    const csv = toCSV(
      result(
        [column("id"), column("note")],
        [row("modify", [{ value: "1" }, { value: "b,c", before: "a", changed: true }])],
      ),
    );

    const workbook = XLSX.read(csv, { type: "string", raw: false });
    const grid = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
    });

    expect(grid[0]).toEqual(["Change", "Row", "id", "note"]);
    // Stringified because a reader is free to read "2" as a number; what
    // matters is that the quoted comma stayed inside its cell.
    expect(grid[1].map(String)).toEqual(["changed", "2", "1", "a -> b,c"]);
  });
});

describe("exportFileName", () => {
  it("names the file after both sheets", () => {
    expect(exportFileName("before.csv", "after.xlsx")).toBe("diff-before-vs-after.csv");
  });

  it("keeps a name a filesystem will accept", () => {
    expect(exportFileName("Q1 report (final).xlsx", "Q2/report.csv")).toBe(
      "diff-Q1-report-final--vs-Q2-report.csv",
    );
  });
});
