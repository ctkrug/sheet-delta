import { beforeEach, describe, expect, it } from "vitest";
import { renderGrid } from "./grid";
import type { Cell, ColumnDiff, DiffResult, Op, RowResult } from "./types";

function cell(value: string, before?: string): Cell {
  return before === undefined ? { value, changed: false } : { value, before, changed: true };
}

function row(op: Op, cells: Cell[], aIndex = 0, bIndex = 0): RowResult {
  return { op, aIndex, bIndex, cells };
}

function column(name: string, op: Op = "equal"): ColumnDiff {
  return { name, op, aIndex: 0, bIndex: 0 };
}

/** A minimal result; summary is unused by the grid but part of the shape. */
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

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.replaceChildren(container);
});

describe("renderGrid", () => {
  it("renders a header cell per column plus the row-number gutter", () => {
    renderGrid(container, result([column("id"), column("total")], [row("equal", [cell("1"), cell("10")])]));

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["#", "id", "total"]);
  });

  it("renders every row's cells in column order", () => {
    renderGrid(
      container,
      result(
        [column("id"), column("name")],
        [row("equal", [cell("1"), cell("Ada")]), row("equal", [cell("2"), cell("Grace")])],
      ),
    );

    const rows = [...container.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["1", "Ada"],
      ["2", "Grace"],
    ]);
  });

  // Story 5: each kind of row is distinguishable, so the CSS can tint it.
  it("marks each kind of row with its own class", () => {
    renderGrid(
      container,
      result(
        [column("id")],
        [
          row("equal", [cell("1")]),
          row("insert", [cell("2")]),
          row("delete", [cell("3")]),
          row("move", [cell("4")]),
          row("modify", [cell("5", "4")]),
        ],
      ),
    );

    const classes = [...container.querySelectorAll("tbody tr")].map((tr) => tr.className);
    expect(classes).toEqual([
      "grid__row grid__row--equal",
      "grid__row grid__row--insert",
      "grid__row grid__row--delete",
      "grid__row grid__row--move",
      "grid__row grid__row--modify",
    ]);
  });

  // The wow moment, as rendered: only the changed cell is highlighted, and
  // the untouched cells in the same row are not.
  it("highlights only the changed cell of a changed row", () => {
    renderGrid(
      container,
      result(
        [column("id"), column("total")],
        [row("modify", [cell("1"), cell("250", "200")])],
      ),
    );

    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells[0].classList.contains("grid__cell--changed")).toBe(false);
    expect(cells[1].classList.contains("grid__cell--changed")).toBe(true);
    expect(container.querySelectorAll(".grid__cell--changed")).toHaveLength(1);
  });

  it("shows both the old and new value of a changed cell", () => {
    renderGrid(container, result([column("total")], [row("modify", [cell("250", "200")])]));

    const changed = container.querySelector(".grid__cell--changed")!;
    expect(changed.querySelector(".grid__was")?.textContent).toBe("200");
    expect(changed.querySelector(".grid__now")?.textContent).toBe("250");
    expect(changed.getAttribute("title")).toContain("200");
  });

  it("describes a change to or from empty in words for screen readers", () => {
    renderGrid(
      container,
      result([column("note")], [row("modify", [cell("filled", "")]), row("modify", [cell("", "gone")])]),
    );

    const labels = [...container.querySelectorAll(".grid__cell--changed")].map((c) =>
      c.getAttribute("aria-label"),
    );
    expect(labels[0]).toBe("changed from empty to filled");
    expect(labels[1]).toBe("changed from gone to empty");
  });

  it("marks added and removed columns", () => {
    renderGrid(
      container,
      result(
        [column("id"), column("added", "insert"), column("dropped", "delete")],
        [row("equal", [cell("1"), cell("new"), cell("old")])],
      ),
    );

    expect(container.querySelector(".grid__col--insert")?.textContent).toBe("added");
    expect(container.querySelector(".grid__col--delete")?.textContent).toBe("dropped");
    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells[1].classList.contains("grid__cell--col-insert")).toBe(true);
    expect(cells[2].classList.contains("grid__cell--col-delete")).toBe(true);
  });

  it("numbers rows by their position in the sheet, allowing for the header", () => {
    renderGrid(
      container,
      result(
        [column("id")],
        [row("equal", [cell("a")], 0, 0), row("delete", [cell("b")], 4, -1)],
      ),
    );

    const numbers = [...container.querySelectorAll(".grid__rownum")].map((n) => n.textContent);
    expect(numbers).toEqual(["2", "6"]);
  });

  it("replaces a previous diff rather than appending to it", () => {
    const first = result([column("id")], [row("equal", [cell("1")])]);
    const second = result([column("other")], [row("equal", [cell("2")])]);

    renderGrid(container, first);
    renderGrid(container, second);

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("tbody td")?.textContent).toBe("2");
  });

  it("shows a designed empty state when there is nothing to compare", () => {
    renderGrid(container, result([], []));

    expect(container.querySelector(".grid__empty")).not.toBeNull();
    expect(container.textContent).toContain("empty");
    expect(container.querySelector("table")).toBeNull();
  });

  describe("row limit", () => {
    const many = (n: number) =>
      result([column("id")], Array.from({ length: n }, (_, i) => row("equal", [cell(String(i))])));

    it("renders every row when under the limit", () => {
      renderGrid(container, many(10), { rowLimit: 10 });

      expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
      expect(container.querySelector(".grid__notice")).toBeNull();
    });

    // A cap that hides rows without saying so would read as "no more
    // changes" — the one thing a diff tool must never imply.
    it("says how many rows it held back rather than truncating silently", () => {
      renderGrid(container, many(25), { rowLimit: 10 });

      expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
      const notice = container.querySelector(".grid__notice");
      expect(notice?.textContent).toContain("10");
      expect(notice?.textContent).toContain("25");
    });

    it("renders the held-back rows on request", async () => {
      renderGrid(container, many(25), { rowLimit: 10 });

      container.querySelector<HTMLButtonElement>(".grid__notice button")!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
      expect(container.querySelector(".grid__notice")).toBeNull();
    });
  });
});
