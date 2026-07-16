import type { Summary } from "./types";

/**
 * The diff summary bar: rows added / removed / changed / moved and the
 * total cells changed.
 *
 * Counters roll from their previous value to the new one rather than
 * snapping, per the ledger/odometer flourish in docs/DESIGN.md — dropping
 * a new file pair should read as a tally landing, not a text swap.
 */

/** How long a counter takes to roll to its new value. */
const ROLL_MS = 420;

interface Counter {
  key: keyof Summary;
  label: string;
  /** Modifier for the counter's accent, matching the grid's row colors. */
  tone: "added" | "removed" | "changed" | "moved" | "neutral";
}

const COUNTERS: Counter[] = [
  { key: "rowsAdded", label: "added", tone: "added" },
  { key: "rowsRemoved", label: "removed", tone: "removed" },
  { key: "rowsChanged", label: "changed", tone: "changed" },
  { key: "rowsMoved", label: "moved", tone: "moved" },
  { key: "cellsChanged", label: "cells", tone: "neutral" },
];

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Eases out, so the tally decelerates into place like an odometer. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Animates a counter from its current value to `to`.
 *
 * Reduced motion — and any environment without rAF, such as a test — gets
 * the final value immediately. The number is always correct; only the way
 * it arrives changes.
 */
function rollTo(node: HTMLElement, to: number): void {
  const from = Number(node.dataset.value ?? "0");
  node.dataset.value = String(to);

  if (from === to || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
    node.textContent = to.toLocaleString();
    return;
  }

  const start = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - start) / ROLL_MS, 1);
    const value = Math.round(from + (to - from) * easeOut(progress));
    node.textContent = value.toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Human wording for the live region, so a screen reader hears a sentence. */
function describe(summary: Summary): string {
  const parts = [
    `${summary.rowsAdded} rows added`,
    `${summary.rowsRemoved} rows removed`,
    `${summary.rowsChanged} rows changed`,
    `${summary.rowsMoved} rows moved`,
    `${summary.cellsChanged} cells changed`,
  ];
  if (summary.columnsAdded > 0) parts.push(`${summary.columnsAdded} columns added`);
  if (summary.columnsRemoved > 0) parts.push(`${summary.columnsRemoved} columns removed`);
  return `Comparison complete: ${parts.join(", ")}.`;
}

/**
 * A summary bar bound to a container, updatable in place.
 *
 * The bar is built once and updated per diff so the counters can roll from
 * their previous values — rebuilding the DOM would lose them.
 */
export interface SummaryBar {
  update(summary: Summary): void;
}

export function createSummaryBar(container: HTMLElement): SummaryBar {
  container.replaceChildren();
  container.classList.add("summary");

  const values = new Map<keyof Summary, HTMLElement>();
  for (const counter of COUNTERS) {
    const item = document.createElement("div");
    item.className = `summary__item summary__item--${counter.tone}`;

    const value = document.createElement("span");
    value.className = "summary__value";
    value.dataset.value = "0";
    value.textContent = "0";

    const label = document.createElement("span");
    label.className = "summary__label";
    label.textContent = counter.label;

    item.append(value, label);
    container.append(item);
    values.set(counter.key, value);
  }

  // Column changes are rarer than row changes, so they get a chip that
  // appears only when there is something to say instead of two more
  // permanent zeroes competing with the counts that matter.
  const columns = document.createElement("p");
  columns.className = "summary__columns";
  columns.hidden = true;
  container.append(columns);

  // The counters are visual; a screen reader gets the same facts as a
  // sentence when a comparison finishes.
  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  container.append(live);

  return {
    update(summary: Summary): void {
      for (const [key, node] of values) {
        rollTo(node, summary[key]);
      }

      const notes: string[] = [];
      if (summary.columnsAdded > 0) notes.push(`+${summary.columnsAdded} column${summary.columnsAdded === 1 ? "" : "s"}`);
      if (summary.columnsRemoved > 0) notes.push(`−${summary.columnsRemoved} column${summary.columnsRemoved === 1 ? "" : "s"}`);
      columns.textContent = notes.join("  ");
      columns.hidden = notes.length === 0;

      live.textContent = describe(summary);
    },
  };
}
