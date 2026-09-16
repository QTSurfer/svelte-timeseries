import { expect, test, type Page } from "@playwright/test";

async function visibleRows(page: Page) {
  const value = await page
    .locator("#svelte-timeseries")
    .getAttribute("data-visible-rows");
  return Number(value);
}

async function waitForInitialData(page: Page) {
  await expect
    .poll(() => visibleRows(page), { timeout: 60_000 })
    .toBeGreaterThan(600_000);
}

test("renders the full primary series without a false horizontal segment", async ({
  page,
}) => {
  await page.goto("/");
  await waitForInitialData(page);

  await expect(page).toHaveScreenshot("primary-series.png", {
    clip: { x: 380, y: 230, width: 1015, height: 540 },
    maxDiffPixels: 500,
  });
});

test("keeps the global overview stable while panning the primary series", async ({
  page,
}) => {
  await page.goto("/");
  await waitForInitialData(page);
  const before = await visibleRows(page);

  await page.mouse.move(870, 830);
  await page.mouse.down();
  await page.mouse.move(1040, 830, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => visibleRows(page), { timeout: 60_000 })
    .toBeLessThan(before);
  await page.mouse.move(0, 0);
  await page
    .locator("div.absolute.bottom-4.w-full.z-10.text-sm")
    .evaluate((element) => {
      (element as HTMLElement).style.visibility = "hidden";
    });
  await expect(page).toHaveScreenshot("panned-overview.png", {
    clip: { x: 395, y: 795, width: 957, height: 75 },
    maxDiffPixels: 500,
  });
});
