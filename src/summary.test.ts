import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSummaryBar } from "./summary";
import type { Summary } from "./types";

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

/** Counters roll over several frames; this waits for them to land. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1000);
}

function valuesIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".summary__value")].map((n) => n.textContent ?? "");
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.replaceChildren(container);
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

describe("createSummaryBar", () => {
  it("starts every counter at zero", () => {
    createSummaryBar(container);

    expect(valuesIn(container)).toEqual(["0", "0", "0", "0", "0"]);
  });

  // Story 6: counts for rows added, removed, changed, and total cells.
  it("shows the counts from the summary", async () => {
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ rowsAdded: 3, rowsRemoved: 2, rowsChanged: 5, rowsMoved: 1, cellsChanged: 9 }));
    await settle();

    expect(valuesIn(container)).toEqual(["3", "2", "5", "1", "9"]);
  });

  // Story 6: a new file pair updates the counts without a page reload.
  it("rolls to new counts when a second diff arrives", async () => {
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ rowsAdded: 10, cellsChanged: 40 }));
    await settle();
    bar.update(summaryOf({ rowsAdded: 2, cellsChanged: 1 }));
    await settle();

    expect(valuesIn(container)).toEqual(["2", "0", "0", "0", "1"]);
  });

  it("passes through a mid-roll value on its way to the final count", async () => {
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ rowsAdded: 100 }));
    await vi.advanceTimersByTimeAsync(16);
    const midRoll = Number(valuesIn(container)[0]);
    await settle();

    expect(midRoll).toBeLessThan(100);
    expect(Number(valuesIn(container)[0])).toBe(100);
  });

  it("groups thousands so a big tally stays readable", async () => {
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ cellsChanged: 12345 }));
    await settle();

    expect(valuesIn(container)[4]).toBe((12345).toLocaleString());
  });

  it("mentions column changes only when there are some", async () => {
    const bar = createSummaryBar(container);
    const columns = () => container.querySelector<HTMLElement>(".summary__columns")!;

    bar.update(summaryOf({ rowsAdded: 1 }));
    expect(columns().hidden).toBe(true);

    bar.update(summaryOf({ columnsAdded: 2, columnsRemoved: 1 }));
    expect(columns().hidden).toBe(false);
    expect(columns().textContent).toContain("2 columns");
    expect(columns().textContent).toContain("1 column");

    bar.update(summaryOf());
    expect(columns().hidden).toBe(true);
  });

  it("announces the result in a live region", () => {
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ rowsAdded: 1, rowsRemoved: 2, cellsChanged: 3 }));

    const live = container.querySelector("[role='status']");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toContain("1 rows added");
    expect(live?.textContent).toContain("2 rows removed");
    expect(live?.textContent).toContain("3 cells changed");
  });

  it("jumps straight to the final count when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const bar = createSummaryBar(container);

    bar.update(summaryOf({ rowsAdded: 500 }));

    expect(valuesIn(container)[0]).toBe("500");
    vi.unstubAllGlobals();
  });
});
