import { createAsyncDuckDB } from './duckdb/duckdb-wasm';

/**
 * Marker shapes used by the synthetic demo scenario — the four cross-engine-consistent icons
 * (ChartMarkerPointOptions.icon's doc comment in @qtsurfer/sveltecharts): the only ones
 * guaranteed to render as genuinely distinct shapes in ECharts, Lightweight Charts, AND Vela
 * (Vela hand-builds square/arrowUp/arrowDown as filled polylines — see
 * VelaTimeSeriesChartBuilder's customMarkerShape).
 */
// Clustered tightly around the exact center bar rather than spread across the range — ECharts'
// own default dataZoom window (45%-55%, see TimeSeriesChartBuilder's dataZoom default) is a
// fixed ~10% of the dataset regardless of its size, while Vela's default view instead anchors to
// the MOST RECENT bars (confirmed empirically — the two engines default to different ends of a
// large dataset, with no single bar range satisfying both). Keeping BARS small (see below) is
// what actually reconciles them: small enough that Vela's "recent" window and Lightweight's own
// default both show the WHOLE series anyway, so only ECharts' narrow middle window needs an
// exact marker placement.
const SYNTHETIC_MARKERS = [
	{ bar: 36, shape: 'circle', color: '#2563eb', text: 'Circle' },
	{ bar: 38, shape: 'square', color: '#d97706', text: 'Square' },
	{ bar: 40, shape: 'arrowUp', color: '#16a34a', text: 'Buy (arrowUp)' },
	{ bar: 42, shape: 'arrowDown', color: '#dc2626', text: 'Sell (arrowDown)' }
] as const;

// Small on purpose — see SYNTHETIC_MARKERS' comment on why this is what actually makes the
// markers visible by default across all three chart engines, not just a performance concern.
const BARS = 80;

/**
 * Generates a synthetic OHLCV candlestick series (a random walk, so every run looks a little
 * different) plus a handful of markers covering all four cross-engine-consistent icons, and
 * returns it as real Parquet bytes — the same `tables.<name>.parquet: BinarySource` shape the
 * demo's own file-upload path already feeds into `DuckDB.create` (see `+page.svelte`'s
 * `loadCustomSource`), so no changes to the DuckDB registry are needed.
 *
 * Generation runs entirely in SQL on a throwaway DuckDB-wasm instance (`generate_series` +
 * `COPY ... TO ... (FORMAT PARQUET)` + `copyFileToBuffer`) rather than building JS arrays,
 * because `DuckDBRegistry.registerFileSource` only ever scans a registered buffer with
 * `parquet_scan`/`read_lastra` — it doesn't accept raw Arrow/CSV/JSON bytes, so the data has to
 * already BE a real Parquet file by the time it reaches that registry.
 *
 * The marker-bearing bars (36/38/40/42 of 80) sit inside ECharts' own default 45%-55% dataZoom
 * window (see TimeSeriesChartBuilder's dataZoom default) and within Lightweight's/Vela's own
 * default views too (see SYNTHETIC_MARKERS' comment on why a small total bar count is what makes
 * that true), so every marker is visible without the user having to zoom/scroll first.
 */
export async function generateSyntheticCandles(): Promise<Uint8Array> {
	const db = await createAsyncDuckDB();
	try {
		const conn = await db.connect();
		try {
			const markerCases = SYNTHETIC_MARKERS.map(
				(m) =>
					`WHEN ${m.bar} THEN '{"shape":"${m.shape}","color":"${m.color}","position":"inBar","text":"${m.text}"}'`
			).join(' ');

			await conn.query(`
				CREATE OR REPLACE TABLE synthetic AS
				WITH seq AS (
					SELECT
						i,
						CAST(now() AS TIMESTAMP) - INTERVAL (${BARS} - i) MINUTE AS ts,
						(random() - 0.5) * 2 AS step
					FROM range(${BARS}) AS t(i)
				),
				walked AS (
					SELECT i, ts, 100.0 + SUM(step) OVER (ORDER BY i) AS close FROM seq
				),
				with_open AS (
					SELECT i, ts, COALESCE(LAG(close) OVER (ORDER BY i), close) AS open, close
					FROM walked
				),
				with_hl AS (
					SELECT
						i, ts, open, close,
						GREATEST(open, close) + random() * 0.8 AS high,
						LEAST(open, close) - random() * 0.8 AS low
					FROM with_open
				),
				with_sma AS (
					SELECT
						*,
						AVG(close) OVER (ORDER BY i ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS sma
					FROM with_hl
				)
				SELECT
					ts AS _ts,
					open,
					high,
					low,
					close,
					sma,
					CASE i ${markerCases} END AS _m
				FROM with_sma
				ORDER BY i;
			`);
			await conn.query(`COPY synthetic TO 'synthetic.parquet' (FORMAT PARQUET);`);
			return await db.copyFileToBuffer('synthetic.parquet');
		} finally {
			await conn.close();
		}
	} finally {
		await db.terminate();
	}
}
