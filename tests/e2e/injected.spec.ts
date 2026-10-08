import { expect, test, type Page } from "@playwright/test";

// Demo data of the /injected route: 1 bar per minute from this instant; three buys share the second
// of bar 495 (see packages/svelte-timeseries/src/routes/injected/demoData.ts).
const START = Date.UTC(2025, 9, 28, 14, 0, 0);
const CROWDED_BAR_MS = START + 495 * 60_000;

type DemoWindow = Window & {
  __demo: {
    current: {
      LightweightChart: {
        panes(): { getSeries(): { options(): { title: string } }[] }[];
        timeScale(): {
          timeToCoordinate(time: number): number | null;
          getVisibleRange(): { from: number; to: number } | null;
          setVisibleRange(range: { from: number; to: number }): void;
        };
      };
      ECharts: {
        convertToPixel(finder: object, value: number[]): number[];
      };
      option: { dataset: { source: Record<string, number[]> } };
    };
  };
};

async function chartsCreated(page: Page) {
  const text = await page.getByTestId("created").textContent();
  return Number(text?.match(/\d+/)?.[0]);
}

// The page starts on Lightweight Charts. Wait for hydration (the first chart) before touching the
// controls, otherwise the selection is lost when the page hydrates.
async function open(page: Page, engine: "lightweight" | "echarts") {
  await page.goto("/injected");
  await expect.poll(() => chartsCreated(page)).toBe(1);
  if (engine === "echarts") {
    await page.getByTestId("engine").selectOption("echarts");
    await expect.poll(() => chartsCreated(page)).toBe(2);
  }
  await expect(page.locator("canvas").first()).toBeVisible();
}

test("draws price arrays without starting DuckDB", async ({ page }) => {
  const workers: string[] = [];
  const requested: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("request", (request) => requested.push(request.url()));

  await open(page, "lightweight");

  // A DuckDB instance runs in a Web Worker and reads its file over HTTP.
  expect(workers).toEqual([]);
  expect(requested.filter((url) => url.includes(".parquet"))).toEqual([]);
});

test("lists every marker of a crowded second in the hover text", async ({
  page,
}) => {
  await open(page, "lightweight");

  const x = await page.evaluate((ms) => {
    const { current } = (window as unknown as DemoWindow).__demo;
    return current.LightweightChart.timeScale().timeToCoordinate(
      Math.floor(ms / 1000),
    );
  }, CROWDED_BAR_MS);
  expect(x).not.toBeNull();

  const box = await page.locator(".lightweight-charts").first().boundingBox();
  await page.mouse.move(box!.x + x!, box!.y + 120);

  const tooltip = page.locator(".lw-tooltip");
  await expect(tooltip).toContainText("Partial fill at +100 ms");
  await expect(tooltip).toContainText("Partial fill at +450 ms");
  await expect(tooltip).toContainText("Partial fill at +800 ms");
});

test("updates series and markers in place, keeping the chart and its visible range", async ({
  page,
}) => {
  await open(page, "lightweight");

  // Lightweight Charts applies a new range on its next animation frame, so read it after two frames.
  const range = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    return page.evaluate(() => {
      const { current } = (window as unknown as DemoWindow).__demo;
      return current.LightweightChart.timeScale().getVisibleRange();
    });
  };
  // The chart is still settling after it is created (it resizes to its container); wait until the
  // visible range stops moving before using it as the reference.
  const settled = async () => {
    let previous = JSON.stringify(await range());
    await expect
      .poll(async () => {
        const current = JSON.stringify(await range());
        const stable = current === previous;
        previous = current;
        return stable;
      })
      .toBe(true);
    return range();
  };

  await settled();
  await page.evaluate(() => {
    const scale = (
      window as unknown as DemoWindow
    ).__demo.current.LightweightChart.timeScale();
    const visible = scale.getVisibleRange()!;
    const span = visible.to - visible.from;
    scale.setVisibleRange({
      from: visible.from + span * 0.3,
      to: visible.from + span * 0.6,
    });
  });
  const before = await settled();

  for (const id of [
    "toggle-ema",
    "toggle-ema",
    "toggle-markers",
    "toggle-markers",
    "append",
  ]) {
    await page.getByTestId(id).click();
  }

  expect(await chartsCreated(page)).toBe(1);
  expect(await settled()).toEqual(before);
});

test("shows marker texts on the ECharts backend too", async ({ page }) => {
  await open(page, "echarts");

  const point = await page.evaluate((ms) => {
    const { current } = (window as unknown as DemoWindow).__demo;
    const price = current.option.dataset.source["Price"][495];
    return current.ECharts.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
      ms + 100,
      price,
    ]);
  }, CROWDED_BAR_MS);

  const box = await page.locator(".echarts").first().boundingBox();
  // The buy arrows sit one symbol height below their anchor.
  await page.mouse.move(box!.x + point[0], box!.y + point[1] + 14);

  await expect(page.locator("[role=tooltip]").first()).toContainText(
    "Partial fill at +450 ms",
  );
});

test("keeps the parquet path working with injected series", async ({
  page,
}) => {
  await open(page, "lightweight");
  await page.getByTestId("scenario").selectOption("parquet");

  await expect(page.locator("#svelte-timeseries summary")).toHaveText(
    /SCHEMA/,
    { timeout: 60_000 },
  );
  // The file's column plus the moving average the demo computes from it and injects.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as DemoWindow
          ).__demo.current.LightweightChart.panes()[0]
            .getSeries()
            .map((series) => series.options().title),
        ),
      { timeout: 60_000 },
    )
    .toEqual(["temp", "Moving average (5)"]);
});

// Vela draws candles only and has no injected series, markers or panes. These check that the two
// entries (the arrays chart and the table chart) say so instead of ignoring the input silently.
function collectWarnings(page: Page) {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  return warnings;
}

async function openVela(page: Page, scenario: "line" | "candles" | "parquet") {
  await page.goto("/injected");
  await expect.poll(() => chartsCreated(page)).toBe(1);
  await page.getByTestId("scenario").selectOption(scenario);
  await page.getByTestId("engine").selectOption("vela");
}

test("draws candles from arrays on Vela and warns once about the injected input it cannot draw", async ({
  page,
}) => {
  const warnings = collectWarnings(page);
  await openVela(page, "candles");

  await expect(page.locator(".vela-charts canvas").first()).toBeVisible();
  await expect.poll(() => chartsCreated(page)).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => warnings.filter((text) => text.includes("injectedSeries")))
    .toHaveLength(1);

  // New arrays are an update, not a new complaint.
  for (const id of ["append", "toggle-ema", "toggle-ema", "toggle-markers"]) {
    await page.getByTestId(id).click();
  }
  const ours = warnings.filter((text) => text.includes('chartLibrary="vela"'));
  expect(ours.filter((text) => text.includes('"injectedSeries"'))).toHaveLength(1);
  expect(ours.filter((text) => text.includes('"injectedMarkers"'))).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("rejects a price line on Vela with a visible message", async ({ page }) => {
  const warnings = collectWarnings(page);
  await openVela(page, "line");

  await expect(page.getByRole("alert")).toContainText("draws candles only");
  expect(warnings.some((text) => text.includes("draws candles only"))).toBe(true);
});

test("tells the table chart that Vela needs candles", async ({ page }) => {
  await openVela(page, "parquet");

  await expect(page.locator(".wrapper-error")).toContainText(
    "Vela chart engine only supports candlestick data",
    { timeout: 60_000 },
  );
});
