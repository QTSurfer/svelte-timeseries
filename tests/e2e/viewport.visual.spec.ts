import { expect, test, type Page } from "@playwright/test";

async function chartState(page: Page) {
  return page.evaluate(async () => {
    const chart = document.querySelector<HTMLElement>(".echarts");
    const moduleUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => name.includes("/deps/echarts.js"));
    if (!chart || !moduleUrl) return null;
    const echarts = await import(/* @vite-ignore */ moduleUrl);
    const instance = echarts.getInstanceByDom(chart);
    if (!instance) return null;
    const option = instance.getOption();
    const source = option?.dataset?.[0]?.source as
      | { _ts: number[] }
      | undefined;
    if (!source?._ts?.length) return null;
    const overview = option.series?.[0]?.data as [number, number][] | undefined;
    return {
      rows: source._ts.length,
      overview: {
        rows: overview?.length ?? source._ts.length,
        first: overview?.[0]?.[0] ?? source._ts[0],
        last:
          overview?.[overview.length - 1]?.[0] ??
          source._ts[source._ts.length - 1],
      },
    };
  });
}

test("renders the full primary series without a false horizontal segment", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(async () => (await chartState(page))?.rows)
    .toBeGreaterThan(600_000);

  await expect(page).toHaveScreenshot("primary-series.png", {
    clip: { x: 380, y: 230, width: 1015, height: 540 },
    maxDiffPixels: 500,
  });
});

test("keeps the global overview stable while panning the primary series", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(async () => (await chartState(page))?.rows)
    .toBeGreaterThan(600_000);
  await page.getByText("Initial Loading", { exact: false }).waitFor();
  const before = await chartState(page);

  await page.mouse.move(870, 830);
  await page.mouse.down();
  await page.mouse.move(1040, 830, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => (await chartState(page))?.rows)
    .toBeLessThan(600_000);
  await expect
    .poll(async () => (await chartState(page))?.overview)
    .toEqual(before!.overview);
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
