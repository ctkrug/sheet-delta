/**
 * Smoke-tests the app in a real browser, on the real compiled engine.
 *
 * The vitest suite runs in jsdom, which has no layout, no scrolling and no
 * WebAssembly, so three of the app's claims are invisible to it: that the
 * grid header stays pinned, that the page never scrolls sideways, and that
 * a file dropped on the page reaches the Go engine at all. Those are also
 * exactly the claims a user checks in the first ten seconds. This drives
 * Chromium and asserts them.
 *
 * Usage: npm run test:browser (requires npm run build:wasm first).
 */
import { chromium } from "playwright";
import { createServer } from "vite";

const PORT = 5178;
let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}\n    got:  ${JSON.stringify(actual)}\n    want: ${JSON.stringify(expected)}`);
  }
}

const csv = (body) => ({ name: "sheet.csv", mimeType: "text/csv", buffer: Buffer.from(body) });

/** Feeds a side's file input, which is what the browse dialog does. */
async function give(page, side, file) {
  await page.locator(".dropzone input[type=file]").nth(side).setInputFiles(file);
}

async function compare(page, before, after) {
  await give(page, 0, csv(before));
  await page.waitForTimeout(300);
  await give(page, 1, csv(after));
  await page.waitForSelector(".stage[data-view='diff'] .grid__table", { timeout: 30_000 });
}

const server = await createServer({ root: process.cwd(), server: { port: PORT } });
await server.listen();
const browser = await chromium.launch();

try {
  // ---- the wow moment, through the real engine ---------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

    await compare(
      page,
      "id,name,total\n1,Ada,100\n2,Grace,200\n3,Alan,300\n",
      "id,name,total\n3,Alan,300\n1,Ada,100\n2,Grace,250\n",
    );

    check("one cell is highlighted", await page.locator(".grid__cell--changed").count(), 1);
    check(
      "the highlighted cell shows both values",
      (await page.locator(".grid__cell--changed").textContent()).replace(/\s+/g, ""),
      "200250",
    );
    check("the reorder is not an add or a remove", await page.locator(".grid__row--insert, .grid__row--delete").count(), 0);
    check("the summary announces the tally", (await page.locator("[role=status][aria-live=polite]").first().textContent()).includes("1 cell changed"), true);
    check("nothing errored on the page", errors, []);
    await page.close();
  }

  // ---- a row that both moved and changed ---------------------------------
  // The engine's own tests cover this, but it is the one result users judge
  // the tool by, so it is worth one end-to-end pass on the real binary.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await compare(
      page,
      "id,region,total\n1,North,200\n2,South,300\n3,East,410\n",
      "id,region,total\n2,South,300\n1,North,250\n3,East,410\n",
    );

    check("the moved-and-edited row is one changed cell", await page.locator(".grid__cell--changed").count(), 1);
    check("it is not reported as an add plus a remove", await page.locator(".grid__row--insert, .grid__row--delete").count(), 0);
    await page.close();
  }

  // ---- the same data from two exporters ----------------------------------
  // Excel writes CSV with a BOM, Google Sheets does not. Comparing one
  // against the other is an ordinary thing to do and must be quiet.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    const body = "id,name,city\n1,José,東京\n2,Zoë,Köln\n";
    await compare(page, `﻿${body}`, body);

    check("a BOM alone is not a change", await page.locator(".grid__cell--changed").count(), 0);
    check(
      "non-ASCII text survives the round trip",
      (await page.locator(".grid__table").textContent()).includes("José"),
      true,
    );
    await page.close();
  }

  // ---- layout claims jsdom cannot see ------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

    let rows = "id,region,total\n";
    for (let i = 0; i < 6_000; i++) rows += `${i},R${i % 7},${i * 3}\n`;
    await compare(page, rows, rows.replace("\n5,R5,15\n", "\n5,R5,99\n"));

    check("the grid caps at 5,000 rendered rows", await page.locator(".grid__row").count(), 5_000);
    check(
      "the cap is stated, never silent",
      (await page.locator(".grid__notice-text").textContent()).includes("5,000 of 6,000"),
      true,
    );

    // Story 5: the header stays put while the grid's own region scrolls.
    const head = page.locator(".grid__head th").first();
    const y = (await head.boundingBox()).y;
    await page.locator(".grid__scroll").evaluate((n) => (n.scrollTop = 1_500));
    await page.waitForTimeout(150);
    check("the header stays pinned while scrolling", Math.abs((await head.boundingBox()).y - y) < 1, true);

    await page.locator(".grid__notice button").click();
    await page.waitForFunction(() => document.querySelectorAll(".grid__row").length === 6_000, null, { timeout: 30_000 });
    check("show-all renders every row", await page.locator(".grid__row").count(), 6_000);
    await page.close();
  }

  // ---- responsive: no sideways scroll at any width ------------------------
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await compare(page, "id,total\n1,200\n", "id,total\n1,250\n");
    // A wide sheet must scroll inside the grid, not push the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`no horizontal page scroll at ${width}px`, overflow, 0);
    await page.close();
  }

  // ---- keyboard only ------------------------------------------------------
  // Story 15: the whole upload flow has to be reachable without a mouse.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

    const stops = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const a = document.activeElement;
          const outline = getComputedStyle(a).outlineStyle;
          return { label: a.getAttribute("aria-label") ?? a.textContent.trim(), focusRing: outline !== "none" };
        }),
      );
    }
    check("tab reaches both zones then the source link, each visibly focused", stops.map((s) => s.focusRing), [true, true, true]);
    check("the first stop is the Before zone", stops[0].label.startsWith("Before file"), true);

    // Enter on the zone must open the file browser, or the keyboard path
    // dead-ends at a control that looks focusable but does nothing.
    await page.evaluate(() => {
      window.__opened = false;
      document.querySelector(".dropzone input[type=file]").addEventListener("click", (e) => {
        e.preventDefault();
        window.__opened = true;
      });
    });
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    check("enter on a zone opens the file browser", await page.evaluate(() => window.__opened), true);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nbrowser smoke test passed");
process.exit(0);
