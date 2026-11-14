// Real-browser smoke check for the fixture explorer.
//
// Start the backend and Vite dev server first, then from apps/web run:
//   node scripts/browser-smoke.mjs
//
// Set WEB_URL if the dev server is not on http://127.0.0.1:5173.
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const SCREENSHOT =
  process.env.SMOKE_SCREENSHOT ?? join(tmpdir(), "news-trace-fixture-explorer.png");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(WEB_URL, { waitUntil: "networkidle", timeout: 30_000 });

  await page.getByTestId("synthetic-badge").waitFor({ timeout: 15_000 });
  await page.getByTestId("source-list").waitFor({ timeout: 15_000 });
  await page.getByTestId("root-badge").first().waitFor({ timeout: 15_000 });
  await page.getByTestId("seed-badge").first().waitFor({ timeout: 15_000 });
  await page.getByTestId("time-uncertain-section").waitFor({ timeout: 15_000 });

  const inspectButtons = page.locator('[data-testid^="inspect-"]');
  const selectButtons = page.locator('[data-testid^="select-"]');
  assert((await inspectButtons.count()) >= 2, "expected at least two inspectable sources");
  assert((await selectButtons.count()) >= 2, "expected at least two selectable sources");

  await inspectButtons.nth(0).click();
  await page.getByTestId("detail-panel").waitFor({ timeout: 15_000 });
  const detailText = await page.getByTestId("detail-panel").innerText();
  assert(detailText.length > 40, "detail panel did not render meaningful content");

  await selectButtons.nth(0).click();
  await selectButtons.nth(1).click();
  await page.getByTestId("selection-tray").waitFor({ timeout: 10_000 });

  const slotA = await page.getByTestId("selection-slot-a").innerText();
  const slotB = await page.getByTestId("selection-slot-b").innerText();
  assert(slotA.trim().length > 0, "selection slot A is empty");
  assert(slotB.trim().length > 0, "selection slot B is empty");

  const submit = page.getByTestId("question-submit");
  assert(await submit.isDisabled(), "question submit must be disabled in this milestone");
  const limitation = (await page.locator("body").innerText()).toLowerCase();
  assert(
    limitation.includes("not implemented in this milestone"),
    "missing explicit question-orchestration limitation",
  );

  await mkdir(dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log(`browser smoke passed; screenshot: ${SCREENSHOT}`);
  console.log(`selection A: ${slotA.split("\n")[0]}`);
  console.log(`selection B: ${slotB.split("\n")[0]}`);
} finally {
  await browser.close();
}
