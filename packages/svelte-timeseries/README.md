# @qtsurfer/svelte-timeseries

[![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?label=version&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![npm downloads](https://img.shields.io/npm/dt/%40qtsurfer%2Fsvelte-timeseries?label=downloads&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsvelte-timeseries?style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)

> Professional Svelte component to explore **huge time-series datasets** directly in the browser using DuckDB-WASM, Apache Arrow, and SVECharts.
>
> **[Live Demo](https://qtsurfer.github.io/svelte-timeseries)** | **[GitHub](https://github.com/QTSurfer/svelte-timeseries)**

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key features](#key-features)
4. [Installation](#installation)
5. [Getting started](#getting-started)
6. [Using it with data you already hold](#using-it-with-data-you-already-hold)
7. [Component API](#component-api)
8. [TimeSeriesFacade in practice](#timeseriesfacade-in-practice)
9. [Advanced APIs](#advanced-apis)
10. [Reference scenarios](#reference-scenarios)
11. [Development & testing](#development--testing)
12. [Support & contributions](#support--contributions)

## Overview

`@qtsurfer/svelte-timeseries` ships everything you need to build financial, industrial, or scientific dashboards with millions of data points. The component offers:

- Parquet/Arrow and **Lastra** ingestion via DuckDB-WASM right in the browser.
- Columnar → ECharts transformations powered by Apache Arrow.
- Marker/event overlays synchronized with any dimension.
- Customizable side panels through Svelte snippets.

## Architecture

| Layer                    | Role                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| DuckDB-WASM              | Runs SQL against Parquet without any backend and keeps data in columnar memory.                        |
| `TimeSeriesFacade`       | Coordinates DuckDB + `TimeSeriesChartBuilder`, handles incremental column loads, and exposes UI state. |
| `@qtsurfer/sveltecharts` | Facade that builds and updates ECharts instances declaratively.                                        |
| SvelteKit                | Hosts the component, snippets, and demo routes.                                                        |

## Key features

- **Browser-scale**: battle-tested with datasets above 10M values without page reloads.
- **Lazy dimensions**: additional columns download only when the user toggles them on.
- **Bring your own data**: draw arrays you already hold, plus your own indicator lines (with separate panes) and buy / sell / info markers with hover text, without loading DuckDB.
- **Native markers**: trading signals, alerts, or annotations rendered with custom icons and colors.
- **Replaceable panels**: default column/performance panels can be swapped with your own snippets.
- **Debug mode**: detailed DuckDB/ECharts logs to diagnose cross-browser performance.

## Installation

```bash
pnpm add @qtsurfer/svelte-timeseries
# or
npm install @qtsurfer/svelte-timeseries
yarn add @qtsurfer/svelte-timeseries
```

**Vite / SvelteKit configuration**

This library uses DuckDB-WASM under the hood, which relies on Web Workers and WASM binaries.
To ensure proper behavior in development and SSR (Server-Side Rendering), you must update your Vite configuration.

Add the following to your vite.config.ts (or vite.config.js):

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],

	ssr: {
		// Prevent SvelteKit from externalizing this library during SSR.
		// This ensures Vite processes special imports like `...?url`
		// which are required for DuckDB worker files.
		noExternal: ['@qtsurfer/svelte-timeseries']
	},

	optimizeDeps: {
		// Avoid pre-bundling these packages with esbuild.
		// esbuild cannot handle WASM + Web Worker imports used by DuckDB.
		exclude: ['@qtsurfer/svelte-timeseries', '@duckdb/duckdb-wasm']
	}
});
```

**Explanation**

Forces Vite to include this library in the SSR build pipeline.

- `ssr.noExternal`\
  This allows Vite to correctly transform imports like:\
  \
  `import worker from '...worker.js?url'`\
  which DuckDB uses for its Web Worker runtime.

- `optimizeDeps.exclude`\
  Prevents Vite from trying to pre-bundle this library and DuckDB-WASM using esbuild. esbuild does not understand WASM and Worker imports, so excluding these packages avoids “Cannot read file ...?url” and similar errors.

Requirements:

- SvelteKit project with TypeScript enabled.
- Ability to provide Parquet or [Lastra](https://github.com/QTSurfer/lastra) files either by URL or directly in memory.

## Getting started

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	const tables = {
		temps: {
			url: '/temps_gzip.parquet',
			mainColumn: 'temp'
		}
	};

	const markers = {
		table: 'temps',
		targetColumn: '_signal',
		targetDimension: 'temp'
	};
</script>

<SvelteTimeSeries table={tables} {markers} debug={false} externalManagerLegend={true} />
```

You can also pass a Parquet file directly instead of a URL:

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	let parquetFile = $state<File | null>(null);

	const tables = $derived(
		parquetFile
			? {
					temps: {
						parquet: parquetFile,
						mainColumn: 'temp'
					}
				}
			: {}
	);
</script>

<input
	type="file"
	accept=".parquet"
	onchange={(event) => (parquetFile = event.currentTarget.files?.[0] ?? null)}
/>

{#if parquetFile}
	<SvelteTimeSeries table={tables} />
{/if}
```

### Lastra format

The same `table` config accepts a `lastra` source (URL ending in `.lastra`, `Blob`, `File`, `ArrayBuffer`, or `Uint8Array`). The component lazy-loads the [DuckDB community `lastra` extension](https://community-extensions.duckdb.org/extensions/lastra.html) only when a Lastra source is present:

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	const tables = {
		signals: {
			url: '/signals.lastra', // auto-detected by `.lastra` extension
			mainColumn: 'price'
		}
	};
</script>

<SvelteTimeSeries table={tables} />
```

To pass a Lastra file directly from disk, use the `lastra` key instead of `parquet`:

```ts
const tables = {
	uploaded: {
		lastra: lastraFile, // Blob | File | ArrayBuffer | Uint8Array
		mainColumn: 'price'
	}
};
```

## Using it with data you already hold

If your app already has the numbers in memory (an array, a typed array, the output of your own indicator or strategy code) you do not need a Parquet file. Pass the arrays as props: the chart is drawn directly and **DuckDB is never loaded** (no worker, no WASM download). The same inputs also work on top of a `table`, so a file can drive the chart while your app adds what it computes.

- **Time unit:** every `times` array is **epoch milliseconds** (UTC), the unit the rest of the library uses. Multiply by 1000 if you hold seconds. Unsorted input is sorted for you and points without a finite time are dropped.
- **Values:** `number[]`, `Float64Array` or arrays holding `null`. `null` and `NaN` leave a gap, for example while an indicator is not ready yet.
- **Updates:** pass **new arrays** (or a new `injectedSeries` array) and the chart updates in place. Series are matched by name: new ones are added, missing ones are removed and changed ones are updated, without recreating the chart or moving the visible time range. Treat arrays as immutable; changing an array in place is not detected.

### Example: price, an EMA, an RSI pane and markers

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';
	import type { InjectedMarker, InjectedSeries } from '@qtsurfer/svelte-timeseries';

	// 300 one-minute bars. Times are epoch milliseconds; typed arrays work too.
	const times = Float64Array.from({ length: 300 }, (_, i) => Date.UTC(2025, 0, 1) + i * 60_000);
	const close = new Float64Array(300);
	close[0] = 100;
	for (let i = 1; i < close.length; i++) {
		close[i] =
			Math.round((close[i - 1] + Math.sin(i / 9) * 0.4 + Math.cos(i * 2.7) * 0.5) * 100) / 100;
	}

	// Your own indicator code. `null` leaves a gap while an indicator warms up.
	function ema(values: ArrayLike<number>, period: number): (number | null)[] {
		const k = 2 / (period + 1);
		let previous = values[0];
		return Array.from(values, (value, i) => {
			previous = value * k + previous * (1 - k);
			return i < period - 1 ? null : previous;
		});
	}

	function rsi(values: ArrayLike<number>, period: number): (number | null)[] {
		const out: (number | null)[] = new Array(values.length).fill(null);
		let gain = 0;
		let loss = 0;
		for (let i = 1; i < values.length; i++) {
			const change = values[i] - values[i - 1];
			const up = Math.max(change, 0);
			const down = Math.max(-change, 0);
			if (i <= period) {
				// Seed with the plain average of the first `period` moves.
				gain += up / period;
				loss += down / period;
			} else {
				gain = (gain * (period - 1) + up) / period;
				loss = (loss * (period - 1) + down) / period;
			}
			if (i >= period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
		}
		return out;
	}

	const price = { name: 'BTC/USDT', times, values: close };

	const injectedSeries: InjectedSeries[] = [
		// Pane 0 is the price pane.
		{ name: 'EMA 20', times, values: ema(close, 20), color: '#f59e0b', lineWidth: 2 },
		// Any other pane number gets its own pane and price scale.
		{ name: 'RSI 14', times, values: rsi(close, 14), color: '#06b6d4', pane: 1 }
	];

	const injectedMarkers: InjectedMarker[] = [
		{ time: times[60], kind: 'buy', price: close[60], text: 'Entry: EMA turned up' },
		{ time: times[140], kind: 'sell', text: 'Exit: target reached' },
		// Two fills in the same second: one arrow marked "×2", both texts in the hover tooltip.
		{ time: times[200] + 100, kind: 'buy', text: 'Fill 1 of 2' },
		{ time: times[200] + 700, kind: 'buy', text: 'Fill 2 of 2' },
		{ time: times[250], kind: 'info', text: 'Volatility is rising' }
	];
</script>

<div class="frame">
	<SvelteTimeSeries
		chartLibrary="lightweight"
		{price}
		{injectedSeries}
		{injectedMarkers}
		containerClass="fill"
		chartClass="fill"
	/>
</div>

<style>
	.frame {
		height: 520px;
	}
	:global(.fill) {
		width: 100%;
		height: 100%;
	}
</style>
```

Candles instead of a line: replace `{price}` with `candles={{ times, open, high, low, close }}` (all five are arrays; rows with a missing field are not drawn).

### Props

| Prop               | Type                                        | Description                                                                                                                     |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `price?`           | `PriceLineInput`                            | A price line: `{ name?, times, values }` or `{ name?, points: [time, value][] }`. Used when no `table` is given.                |
| `candles?`         | `CandlesInput`                              | Candles: `{ times, open, high, low, close }`. Used when no `table` is given and wins over `price`.                              |
| `injectedSeries?`  | `InjectedSeries[]`                          | Named lines computed by your app (indicators). Works with or without a `table`.                                                 |
| `injectedMarkers?` | `InjectedMarker[]`                          | Buy, sell and info events. Works with or without a `table`.                                                                     |
| `paneHeights?`     | `Record<number, number>`                    | Relative pane heights by pane number, e.g. `{ 0: 2, 1: 1 }`. Default: the price pane `3`, every other pane `1`.                 |
| `onChartReady?`    | `(adapter: TimeSeriesChartAdapter) => void` | Called when the chart exists and its data is drawn; the adapter exposes `setInjectedSeries`, `setInjectedMarkers` and the rest. |

Changing the kind of price data (line to candles, or another `price.name`) builds a new chart. Everything else updates in place.

```ts
type NumericArray = ArrayLike<number | null | undefined>; // number[], Float64Array, (number | null)[], ...

type InjectedSeries = {
	name: string; // unique; used as the title and as the update key
	times: NumericArray; // epoch milliseconds
	values: NumericArray; // null / NaN = gap
	color?: string; // any CSS color; a stable default is picked
	lineWidth?: number; // default 1 (Lightweight Charts draws integers from 1 to 4)
	lineStyle?: 'solid' | 'dashed' | 'dotted';
	pane?: number; // 0 (default) = price pane; other numbers get their own pane
	visible?: boolean; // default true
};

type InjectedMarker = {
	time: number; // epoch milliseconds
	kind: 'buy' | 'sell' | 'info';
	price?: number; // exact level; without it the marker is anchored to the bar
	text?: string; // shown in the hover tooltip
	color?: string; // default per kind: buy green, sell red, info slate
	shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; // default per kind
	series?: string; // name of an injected series to attach to (default: the price series)
};
```

### Panes

`pane: 0` is the price pane. Any other number puts the series in its own pane with its own price scale (an RSI next to a price, for example). Panes are ordered by number and gaps collapse, so `0, 3, 7` become three consecutive panes. The crosshair and the time axis are shared by all panes.

### Markers

- **Default look:** a `buy` is a green arrow up below the bar, a `sell` a red arrow down above it and `info` a neutral circle. With a `price`, the arrow sits just under (buy) or over (sell) that price and the circle is centered on it.
- **Candles and lines:** markers attach to the price series (the candlesticks, or the first loaded line) unless `series` names an injected series. They hide with the series they belong to.
- **Same second:** markers that share a UTC second and look alike (position, shape, color and price) are merged into **one glyph labeled `×N`**, and every original text is listed in the tooltip. Markers of the same second that look different (a sell and an info, say) stay separate glyphs and are stacked on the bar. Nothing is dropped. Markers in different seconds of the same bar are stacked by the chart.
- **Hover text:** on Lightweight Charts the crosshair tooltip lists the markers drawn on the bar under the cursor. On ECharts a small overlay shows them while the pointer is on the marker.
- **Chart text:** marker texts are shown on hover, not drawn on the chart (except the `×N` count). Markers that come from the JSON column keep drawing their text as before.

### What each backend supports

| Capability                                 | Lightweight Charts                                            | ECharts                                           | Vela                                           |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Injected lines (color, width, style, gaps) | Yes                                                           | Yes                                               | No                                             |
| Panes and `paneHeights`                    | Native panes; resizable by dragging the separators            | Stacked grids with a shared zoom and crosshair    | No                                             |
| Markers, including on candlesticks         | Yes                                                           | Yes (mark points)                                 | JSON column markers only, no `injectedMarkers` |
| Same-second merge and stacking             | Yes                                                           | Yes                                               | Overlapping markers are offset                 |
| Marker hover text                          | In the crosshair tooltip, for the whole bar                   | Overlay while the pointer is on the marker symbol | No                                             |
| Line width                                 | Integers from 1 to 4                                          | Any positive number                               | -                                              |
| Times inside the same second               | Collapse to the first point (the chart time is whole seconds) | Kept (millisecond axis)                           | -                                              |

All builders report this through an optional `capabilities` object on the adapter (`injectedSeries`, `panes`, `paneHeights`, `injectedMarkers`, `markerTooltip`); the Vela builder reports every flag as `false`. `setInjectedSeries`, `setInjectedMarkers` and `setPaneHeights` are optional members of `TimeSeriesChartAdapter`, so check before calling them on an adapter you did not create.

`chartLibrary="vela"` draws candlesticks only: a `table` with OHLC columns or `candles` arrays (a table without OHLC data shows an error, a `price` line is rejected with a message). It ignores `injectedSeries`, `injectedMarkers` and `paneHeights` and logs a warning once for each. Vela is Apache-2.0 with an attribution requirement for the charts it draws (see the `NOTICE` of `@luxalgo/vela`).

### Injected series on top of a file

```svelte
<SvelteTimeSeries
	table={{ temps: { url: '/temps_gzip.parquet', mainColumn: 'temp' } }}
	{injectedSeries}
	{injectedMarkers}
/>
```

The URL (Parquet or Lastra) path works exactly as before. Use `onFacadeReady` to read the loaded data (for example `facade.getDuckDB().getSingleDimension(...)`), compute your own series from it and pass the result as `injectedSeries`.

## Component API

| Prop                     | Type                                                                                                                                                                                                             | Description                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table?`                 | `Record<string, { mainColumn: string; columnsSelect?: string[] } & ({ url: string } \| { parquet: BinarySource } \| { lastra: BinarySource })>` where `BinarySource = Blob \| File \| ArrayBuffer \| Uint8Array` | Defines the Parquet/Lastra sources and their primary column; the object key becomes the DuckDB view name. Lastra is auto-detected from URLs ending in `.lastra` or from the `lastra` field. Optional: without it the chart is fed from `price` / `candles` and DuckDB is never loaded. |
| `price?` / `candles?`    | `PriceLineInput` / `CandlesInput`                                                                                                                                                                                | Price data from arrays, used when there is no `table`. See [Using it with data you already hold](#using-it-with-data-you-already-hold).                                                                                                                                                |
| `injectedSeries?`        | `InjectedSeries[]`                                                                                                                                                                                               | Named lines computed by your app (indicators), each optionally in its own pane. Works with or without a `table`.                                                                                                                                                                       |
| `injectedMarkers?`       | `InjectedMarker[]`                                                                                                                                                                                               | Buy / sell / info events with hover text. Works with or without a `table`.                                                                                                                                                                                                             |
| `paneHeights?`           | `Record<number, number>`                                                                                                                                                                                         | Relative pane heights by pane number (default: price pane `3`, others `1`).                                                                                                                                                                                                            |
| `onChartReady?`          | `(adapter: TimeSeriesChartAdapter) => void`                                                                                                                                                                      | Called once the chart exists and its data is drawn (works with and without a `table`).                                                                                                                                                                                                 |
| `markers?`               | `MarkersTableOptions`                                                                                                                                                                                            | Table and JSON column used to build the `markers` view (`shape`, `color`, `position`, `text`).                                                                                                                                                                                         |
| `debug?`                 | `boolean` (default `true`)                                                                                                                                                                                       | Enables verbose DuckDB/builder logging.                                                                                                                                                                                                                                                |
| `externalManagerLegend?` | `boolean` (default `true`)                                                                                                                                                                                       | Passes `externalManagerLegend` to `TimeSeriesChartBuilder`. Disable it to let the chart manage the legend internally.                                                                                                                                                                  |
| `columnsSnippet?`        | `Snippet<[ColumnsProps]>`                                                                                                                                                                                        | Overrides the column toggle panel.                                                                                                                                                                                                                                                     |
| `performanceSnippet?`    | `Snippet<[PerformanceProps]>`                                                                                                                                                                                    | Overrides the performance/metrics panel.                                                                                                                                                                                                                                               |
| `snippetClass?`          | `string`                                                                                                                                                                                                         | CSS classes applied to the snippets wrapper around the columns / markers / performance panels.                                                                                                                                                                                         |

For raw numeric timestamp columns named `_ts`, `ts`, `_t`, or `t`, the component infers the epoch unit from its magnitude. Set `timestampUnit` to `'s'`, `'ms'`, `'us'`, or `'ns'` to override detection; ambiguous values fail with an explicit configuration error. This applies to both Parquet and Lastra sources.

## TimeSeriesFacade in practice

`TimeSeriesFacade` (see `src/lib/TimeSeriesFacade.ts`) encapsulates the component logic:

1. **Initialization** (`initialize`) – downloads the primary column, builds the dataset, and configures legends/icons.
2. **Incremental loading** (`addDimension` / `toggleColumn`) – fetches new columns only when requested.
3. **Markers** (`loadMarkers`) – reads the `markers` view and adds annotations to ECharts.
4. **Observable state** (`getColumns`, `describe`, `getLegendStatus`) – provides data for custom panels without touching DuckDB again.

Import the class directly to craft bespoke dashboards while reusing the DuckDB → Arrow → ECharts pipeline.

## Advanced APIs

### 1. DuckDB

Reuse the same instance to run bespoke SQL before/after chart rendering.

```ts
import { DuckDB } from '@qtsurfer/svelte-timeseries';

const duck = await DuckDB.create(
	{
		signal: {
			url: '/signals.parquet',
			mainColumn: 'price'
		}
	},
	undefined,
	true
);

const rows = await duck.getRangeData('signal', '2024-01-01', '2024-01-31', 1000);
await duck.closeConnection();
```

Key implementations (`src/lib/duckdb/DuckDB.ts`):

- `DuckDB.create` validates `window + Worker`, registers Parquet views, and reports load time.
- `getSingleDimension` normalizes timestamps (ms) and returns Arrow arrays ready for `TimeSeriesChartBuilder`.
- `buildTablesAndSchemas` auto-detects types (casts `%` columns to `DOUBLE`, skips helper fields, builds the `markers` view).
- `transformTableToMatrix` converts Arrow results into `[rows, columns]` matrices consumable by any UI.

### 2. TimeSeriesChartBuilder

Craft fully custom ECharts layouts while reusing legend, marker, and metrics logic.

```ts
import { TimeSeriesChartBuilder } from '@qtsurfer/svelte-timeseries';

const builder = new TimeSeriesChartBuilder(echartsInstance, {
	externalManagerLegend: true
});

builder.setLegendIcon('circle');
builder.setDataset({ _ts: timestamps, price: prices, ema20: ema20Series }, [
	'_ts',
	'price',
	'ema20'
]);

builder.addMarkerPoint(
	{ dimName: 'price', timestamp: timestamps[100], name: 'Breakout' },
	{ icon: 'pin', color: '#FF7F50' }
);

builder.build();
```

## Reference scenarios

Taken from the demo at `packages/svelte-timeseries/src/routes/+page.svelte`:

1. **Minimal data** (`temps_gzip_mini.parquet`): ideal for embedded dashboards or smoke tests.
2. **1 million rows** (`temps_gzip.parquet`): browser stress test without compromising UX.
3. **Partial dataset (1,807,956 values)**: leverages `columnsSelect` to keep the initial payload slim and load indicators on demand.
4. **Full dataset (10,245,084 values)**: showcases dense quantitative strategies with every column available.
5. **Synchronized markers**: active in the last two scenarios to overlay `_m` signals on top of `price`.

## Development & testing

```bash
pnpm install
pnpm dev --filter svelte-timeseries
```

- Sample Parquet files live in `packages/svelte-timeseries/static`. Adjust the demo `baseUrl` when publishing behind a CDN.
- Useful debugging helpers in `DuckDB.ts`: `closeConnection`, `getRangeData`, `getMarkers`.
- Pass `debug={true}` to measure real load times per browser.

## Support & contributions

- Need another scenario (streaming feeds, intraday aggregations)? Open an issue describing it.
- PRs are welcome—include reproduction steps, sample datasets, and screen captures when UI changes are involved.
- Using the component in production? Share your story so we can showcase it here.
