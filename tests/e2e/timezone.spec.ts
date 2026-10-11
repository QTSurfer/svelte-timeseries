import { expect, test } from "@playwright/test";

// A Parquet file whose time column is TIMESTAMP WITH TIME ZONE: 120 one-minute rows from
// 2025-10-28 10:00 UTC. DuckDB keeps the session time zone of the browser, so a window built from
// epoch milliseconds used to shift by the viewer's offset and come back empty.
const WINDOW_START = Date.UTC(2025, 9, 28, 10, 30);
const WINDOW_END = Date.UTC(2025, 9, 28, 10, 40);

for (const timezoneId of [
  "Europe/Madrid",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
]) {
  test.describe(`viewer in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("a time-zone-aware time column returns the window that was asked for", async ({
      page,
    }) => {
      await page.goto("/injected");
      await expect(page.getByTestId("created")).toContainText("1");

      const result = await page.evaluate(
        async ({ start, end }) => {
          const { DuckDB } = await import("/src/lib/duckdb/DuckDB.ts");
          const db = await DuckDB.create(
            {
              ticks: {
                url: new URL("/ticks_timestamptz.parquet", location.origin)
                  .href,
                mainColumn: "price",
              },
            },
            undefined,
            false,
          );
          const dims = {
            open: "price",
            high: "price",
            low: "price",
            close: "price",
          };
          // The session takes the browser's time zone after its first query, so the answers of the
          // first and of the later queries are compared.
          const rounds = [];
          for (let round = 0; round < 3; round++) {
            const raw = await db.getWindowedData("ticks", ["price"], {
              start,
              end,
            });
            const bars = await db.getWindowedOHLC(
              "ticks",
              ["price"],
              dims,
              "1m",
              { start, end },
              undefined,
              "price",
            );
            rounds.push({
              first: raw._ts[0],
              last: raw._ts[raw._ts.length - 1],
              rows: raw._ts.length,
              bars: bars._ts.length,
            });
          }
          return rounds;
        },
        { start: WINDOW_START, end: WINDOW_END },
      );

      const wanted = {
        first: WINDOW_START,
        last: WINDOW_END,
        rows: 11,
        bars: 11,
      };
      expect(result).toEqual([wanted, wanted, wanted]);
    });
  });
}
