# @qtsurfer/svelte-timeseries

[![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?label=version&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![npm downloads](https://img.shields.io/npm/dt/%40qtsurfer%2Fsvelte-timeseries?label=downloads&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsvelte-timeseries?style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)

> Professional Svelte component to explore **huge time-series datasets** directly in the browser using DuckDB-WASM, Apache Arrow, ECharts, and TradingView Lightweight Charts.
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
8. [Candlestick & OHLC](#candlestick--ohlc)
9. [Lastra binary format](#lastra-binary-format)
10. [Chart libraries](#chart-libraries)
11. [Performance](#performance)
12. [TimeSeriesFacade in practice](#timeseriesfacade-in-practice)
13. [Advanced APIs](#advanced-apis)
14. [Reference scenarios](#reference-scenarios)
15. [Development & testing](#development--testing)
16. [Support & contributions](#support--contributions)

## Overview

`@qtsurfer/svelte-timeseries` ships everything you need to build financial, industrial, or scientific dashboards with millions of data points. The component offers:

- Parquet/Arrow and **Lastra** ingestion via DuckDB-WASM right in the browser.
- Columnar → chart transformations powered by Apache Arrow.
- Marker/event overlays synchronized with any dimension.
- Customizable side panels through Svelte snippets.
- Switchable chart backends: **ECharts** or **TradingView Lightweight Charts** via a single prop.

## Architecture

| Layer                    | Role                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DuckDB-WASM              | Runs SQL against Parquet without any backend and keeps data in columnar memory.                                                             |
| `TimeSeriesFacade`       | Coordinates DuckDB + chart builder, handles incremental column loads, and exposes UI state.                                                 |
| `@qtsurfer/sveltecharts` | Provides `SVECharts` (ECharts) and `SVELightweightCharts` (TradingView) components plus their respective builders behind a unified adapter. |
| SvelteKit                | Hosts the component, snippets, and demo routes.                                                                                             |

## Key features

- **Browser-scale**: battle-tested with datasets above 10M values without page reloads.
- **Lazy dimensions**: additional columns download only when the user toggles them on.
- **Native markers**: trading signals, alerts, or annotations rendered with custom icons and colors.
- **Dual chart backends**: switch between ECharts and TradingView Lightweight Charts with `chartLibrary="lightweight"`.
- **Bring your own data**: draw arrays you already hold, plus your own indicator lines (with separate panes) and buy / sell / info markers with hover text, without loading DuckDB.
- **Adaptive decimal precision**: micro-priced values are not rounded to zero (up to 16 decimals on a price scale, up to 30 in labels and tooltips) and floating-point noise such as `0.1 + 0.2` is not shown as `0.30000000000000004`.
- **Candles from ticks**: aggregate a price line or a ticker feed into candles of any length, from arrays or straight from a Parquet file.
- **Replaceable panels**: default column/performance panels can be swapped with your own snippets.
- **Debug mode**: detailed DuckDB/chart logs to diagnose cross-browser performance.

## Installation

```bash
pnpm add @qtsurfer/svelte-timeseries
# or
npm install @qtsurfer/svelte-timeseries
yarn add @qtsurfer/svelte-timeseries
```

Requirements:

- SvelteKit project with TypeScript enabled.
- Ability to serve Parquet/Arrow or [Lastra](https://github.com/QTSurfer/lastra) files (local assets or CDN).

## Getting started

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	// DuckDB-WASM fetches the file over HTTP from a worker, so `url` has to be absolute: a
	// root-relative path such as '/temps_gzip.parquet' is not resolved.
	const tables = {
		temps: {
			url: `${page.url.origin}/temps_gzip.parquet`,
			mainColumn: 'temp'
		}
	};
</script>

<SvelteTimeSeries table={tables} debug={false} />
```

To overlay markers, name a table that has a JSON column describing them (`{ "shape", "color", "position", "text" }` per row) and the series they belong to:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	const tables = {
		signal: { url: `${page.url.origin}/signals.parquet`, mainColumn: 'price' }
	};
	const markers = { table: 'signal', targetColumn: '_m', targetDimension: 'price' };
</script>

<SvelteTimeSeries table={tables} {markers} debug={false} />
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

### Candles from a price line (ticks, a ticker's last price)

If what you hold is a price per instant rather than finished bars, give `candles` the line and a bar length and the bars are aggregated for you:

```svelte
<SvelteTimeSeries candles={{ times, values: lastPrice, interval: '1m' }} />
```

The same aggregation is exported as a pure function, for when you want the bars yourself (to compute indicators on them, say) or the volume of each bar:

```ts
import { aggregateCandles } from '@qtsurfer/svelte-timeseries';

const bars = aggregateCandles({ times, values: lastPrice, volumes: tradeSizes }, '5s');
// { times, open, high, low, close, volume }: parallel arrays, ready for `candles`
```

- **Interval:** milliseconds or a string such as `'250ms'`, `'1s'`, `'5s'`, `'1m'`, `'15m'`, `'4h'`, `'1d'`. Anything else throws a `RangeError` (as a component prop it is reported in the console and the chart stays empty).
- **Bars:** each covers `[start, start + interval)` and is stamped with `start`. `open` is the first tick, `close` the last, `high` and `low` the extremes. One tick makes a bar with open = high = low = close. Buckets without ticks are skipped: a quiet period is a gap, not a run of flat bars.
- **Alignment:** buckets are whole multiples of the interval counted from the Unix epoch, so they are UTC and no time zone is involved. For lengths up to half a day that divide a day (`'1s'` to `'12h'`) this is the same grid DuckDB's `time_bucket` uses, which is why a Parquet ticker and the same ticks as arrays give identical bars. For day-sized and longer lengths (`'1d'`, `'7d'`) a SQL engine may use another origin or time-zone rule.
- **Input:** unsorted times are sorted first (ticks with equal times keep their input order). Ticks whose time or price is not a finite number (`null`, `NaN`) are skipped together with their volume. Arrays of different lengths are read up to the shorter one. Empty input gives empty arrays.
- **Volume:** `volumes` is the size of each tick (a trade), summed per bar into `volume`. It must not be a running total such as a ticker's rolling 24-hour volume. The chart does not draw it; pass it to `injectedSeries` in its own pane if you want to see it.
- **Lightweight Charts** draws one bar per whole second, so intervals shorter than `'1s'` collapse; ECharts keeps milliseconds.

#### Why a ticker needs this

A ticker row carries a last price plus statistics of a rolling window, typically 24 hours: `open`, `high` and `low` are the window's, not the bar's. Passing them as `candles` draws every bar spanning the whole day's range. Aggregate the last price instead, as above, or see [Ticker feeds](#ticker-feeds) for Parquet files.

### Props

| Prop               | Type                                        | Description                                                                                                                                                               |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price?`           | `PriceLineInput`                            | A price line: `{ name?, times, values }` or `{ name?, points: [time, value][] }`. Used when no `table` is given.                                                          |
| `candles?`         | `CandlesInput \| TickCandlesInput`          | Candles: `{ times, open, high, low, close }`, or a price line to aggregate: `{ times, values, interval, volumes? }`. Used when no `table` is given and wins over `price`. |
| `injectedSeries?`  | `InjectedSeries[]`                          | Named lines computed by your app (indicators). Works with or without a `table`.                                                                                           |
| `injectedMarkers?` | `InjectedMarker[]`                          | Buy, sell and info events. Works with or without a `table`.                                                                                                               |
| `paneHeights?`     | `Record<number, number>`                    | Relative pane heights by pane number, e.g. `{ 0: 2, 1: 1 }`. Default: the price pane `3`, every other pane `1`.                                                           |
| `onChartReady?`    | `(adapter: TimeSeriesChartAdapter) => void` | Called when the chart exists and its data is drawn; the adapter exposes `setInjectedSeries`, `setInjectedMarkers` and the rest.                                           |

Changing the kind of price data (line to candles, or another `price.name`) builds a new chart. Everything else updates in place.

```ts
type NumericArray = ArrayLike<number | null | undefined>; // number[], Float64Array, (number | null)[], ...

type CandleInterval = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`; // 60_000, '1m', '5s', ...

type TickCandlesInput = {
	times: NumericArray; // epoch milliseconds
	values: NumericArray; // price per tick
	interval: CandleInterval; // bar length
	volumes?: NumericArray; // per-tick volume (not drawn)
};

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
	table={{ temps: { url: `${page.url.origin}/temps_gzip.parquet`, mainColumn: 'temp' } }}
	{injectedSeries}
	{injectedMarkers}
/>
```

The URL (Parquet or Lastra) path works exactly as before. Use `onFacadeReady` to read the loaded data (for example `facade.getDuckDB().getSingleDimension(...)`), compute your own series from it and pass the result as `injectedSeries`.

## Component API

| Prop                     | Type                                                                          | Description                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table?`                 | `Record<string, TableData>` (see [TableData reference](#tabledata-reference)) | Defines the Parquet/Lastra sources and their primary column; the object key becomes the DuckDB view name. Optional: without it the chart is fed from `price` / `candles` and DuckDB is never loaded. |
| `price?` / `candles?`    | `PriceLineInput` / `CandlesInput \| TickCandlesInput`                         | Price data from arrays, used when there is no `table`. See [Using it with data you already hold](#using-it-with-data-you-already-hold).                                                              |
| `injectedSeries?`        | `InjectedSeries[]`                                                            | Named lines computed by your app (indicators), each optionally in its own pane. Works with or without a `table`.                                                                                     |
| `injectedMarkers?`       | `InjectedMarker[]`                                                            | Buy / sell / info events with hover text. Works with or without a `table`.                                                                                                                           |
| `paneHeights?`           | `Record<number, number>`                                                      | Relative pane heights by pane number (default: price pane `3`, others `1`).                                                                                                                          |
| `onChartReady?`          | `(adapter: TimeSeriesChartAdapter) => void`                                   | Called once the chart exists and its data is drawn (works with and without a `table`).                                                                                                               |
| `markers?`               | `MarkersTableOptions`                                                         | Table and JSON column used to build the `markers` view (`shape`, `color`, `position`, `text`).                                                                                                       |
| `debug?`                 | `boolean` (default `true`)                                                    | Enables verbose DuckDB/builder logging.                                                                                                                                                              |
| `chartLibrary?`          | `'echarts' \| 'lightweight'` (default `'echarts'`)                            | Selects the chart backend. `'lightweight'` renders via TradingView Lightweight Charts.                                                                                                               |
| `externalManagerLegend?` | `boolean` (default `true`)                                                    | When `true`, legend management is handled by external snippets instead of the chart library.                                                                                                         |
| `isDark?`                | `boolean`                                                                     | Passes dark-mode state to the chart component for theme-aware styling.                                                                                                                               |
| `onFacadeReady?`         | `(facade: TimeSeriesFacade) => void`                                          | Called once the facade is initialized; useful for programmatic access to the facade.                                                                                                                 |
| `columnsSnippet?`        | `Snippet<[ColumnsProps]>`                                                     | Overrides the column toggle panel.                                                                                                                                                                   |
| `markersSnippet?`        | `Snippet<[MarkersProps]>`                                                     | Overrides the markers panel (receives `markers`, `goToMarker`, `toggleMarker`).                                                                                                                      |
| `performanceSnippet?`    | `Snippet<[PerformanceProps]>`                                                 | Overrides the performance/metrics panel.                                                                                                                                                             |
| `containerClass?`        | `string`                                                                      | CSS classes applied to the outer container element.                                                                                                                                                  |
| `chartClass?`            | `string`                                                                      | CSS classes applied to the inner chart element.                                                                                                                                                      |
| `snippetClass?`          | `string`                                                                      | CSS classes applied to the snippets wrapper around the columns / markers / performance panels.                                                                                                       |

## Candlestick & OHLC

### Auto-detection

When a Parquet file contains columns whose names match known OHLC patterns, the component automatically renders a candlestick series without any extra configuration:

| Role  | Recognized column names  |
| ----- | ------------------------ |
| open  | `open`, `_open`, `opn`   |
| high  | `high`, `_high`, `hig`   |
| low   | `low`, `_low`            |
| close | `close`, `_close`, `cls` |

A table that also has `bid` and `ask` columns is a ticker feed, not bar data: see [Ticker feeds](#ticker-feeds). Single-letter column names (`o`, `h`, `l`, `c`) are **not** auto-detected — they collide too often with unrelated columns in non-financial parquets. Use the [explicit mapping](#explicit-mapping) below to opt into them.

### Explicit mapping

Pass a `candlestick` object to override auto-detection with exact column names. (In these examples `origin` stands for the absolute origin of your site, for instance `page.url.origin`: DuckDB-WASM needs absolute file URLs.)

```ts
const tables = {
	btc: {
		url: `${origin}/BTC_USDT_h01_klines.parquet`,
		mainColumn: 'cls',
		candlestick: {
			open: 'opn',
			high: 'hig',
			low: 'low',
			close: 'cls'
		}
	}
};
```

### Disable candlestick (force line)

Set `candlestick: false` to skip OHLC detection entirely and render the `mainColumn` as a plain line series:

```ts
const tables = {
	btc: {
		url: `${origin}/BTC_USDT_h01_klines.parquet`,
		mainColumn: 'cls',
		candlestick: false
	}
};
```

### Ticker feeds

An exchange ticker row holds a last price plus statistics of a rolling window (24 hours for an exchange): `opn`, `hig` and `low` (and `vol`) describe the window, not one bar. Reading them as bar prices draws every candle spanning the whole day's range, so the library never does:

- A table with OHLC-looking columns **and** `bid` and `ask` columns is recognized as a ticker feed (from its schema alone). Its last price, the column that would have been the close (`cls`), is aggregated into candles of `resolution`: for every bucket, DuckDB takes the first, highest, lowest and last price. Without a `resolution` there is nothing to aggregate into, so the price is drawn as a line and the console says how to get candles.
- `candlestick: { price: 'last' }` asks for the same aggregation from any numeric column, for tick data and for tickers whose last price is not detected (`resolution` is required). It is also the way to draw candles from a table that has only a price column.
- An explicit `candlestick: { open, high, low, close }` mapping is always honored, so a bar file that happens to carry `bid` and `ask` columns can opt back in. `candlestick: false` draws the `mainColumn` as a line.

```ts
const tables = {
	ticker: {
		url: `${origin}/btc_usdt_ticker.parquet`, // t, opn, hig, low, cls, vol, bid, ask, ...
		mainColumn: 'cls',
		resolution: '1m' // 1-minute candles of the last price
	},
	ticks: {
		url: `${origin}/trades.parquet`, // ts, price
		mainColumn: 'price',
		candlestick: { price: 'price' },
		resolution: '15s'
	}
};
```

The bar columns are named `<price>_open`, `<price>_high`, `<price>_low` and `<price>` (the close keeps the name of the price column, so markers aimed at it land on the candles). Other columns toggled on in the schema panel are resampled to the same buckets, with the last value of each, so they line up with the candles. Bars are identical to what [`aggregateCandles`](#candles-from-a-price-line-ticks-a-tickers-last-price) gives for the same ticks as arrays.

### Resampling

Use `resolution` to resample OHLC **bars** into larger bars of a fixed size via DuckDB's `time_bucket()`. The format is `<number><unit>` where unit is `s` (seconds), `m` (minutes), `h` (hours), or `d` (days):

```ts
const tables = {
	klines: {
		url: `${origin}/BTC_USDT_1s_klines.parquet`, // opn, hig, low, cls per second
		mainColumn: 'cls',
		resolution: '15m' // aggregate 1-second bars into 15-minute candles
	}
};
```

Valid examples: `'15s'`, `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'4h'`, `'1d'`.

`resolution` applies where there are OHLC columns to resample (detected or mapped): `open = FIRST`, `high = MAX`, `low = MIN`, `close = LAST` for each bucket. A table with just a price column ignores it unless `candlestick: { price }` is set, as in [Ticker feeds](#ticker-feeds). Viewport reloads aggregate the complete source bucket even when a visible boundary falls inside it, so retained candles keep the same OHLC values at every zoom level. When the viewport exceeds the configured point budget, complete candles are sampled deterministically across the requested interval. Additional loaded dimensions use their last value in each retained bucket.

### TableData reference

```ts
type OHLCColumns = {
  open:  string;
  high:  string;
  low:   string;
  close: string;
};

type TickCandlestick = { price: string }; // aggregate this price column into candles, see Ticker feeds

type OHLCResolution = `${number}${'s' | 'm' | 'h' | 'd'}`;
type EpochUnit = 's' | 'ms' | 'us' | 'ns';

type BinarySource = Blob | File | ArrayBuffer | Uint8Array;

// One of three source variants per table entry:
{
  url: string;          // absolute URL of a Parquet or Lastra file (.lastra auto-detected);
                        // DuckDB-WASM does not resolve a root-relative path like '/x.parquet'
  // — or —
  parquet: BinarySource;
  // — or —
  lastra:  BinarySource; // Lastra binary format (DuckDB community extension)

  mainColumn: string;
  columnsSelect?: string[];
  timestampUnit?: EpochUnit;          // raw numeric timestamp unit; auto-detected when omitted

  candlestick?: OHLCColumns | TickCandlestick | false; // explicit bar map, price column to aggregate, or false
  resolution?:  OHLCResolution;       // bucket size: resamples bars, aggregates ticks
}
```

For numeric timestamp candidate columns (`_ts`, `ts`, `_t`, or `t`), the component infers the epoch unit from its magnitude. Set `timestampUnit` explicitly to override detection. If the magnitude is ambiguous, loading fails and requires an explicit unit. This applies equally to Parquet and Lastra sources; native DuckDB timestamp and date columns are unchanged.

## Lastra binary format

In addition to Parquet, `SvelteTimeSeries` accepts [Lastra](https://github.com/QTSurfer/lastra) sources via the [DuckDB community `lastra` extension](https://community-extensions.duckdb.org/extensions/lastra.html). The extension is loaded lazily on first use — only when at least one table entry resolves to a Lastra source.

### By URL

URLs ending in `.lastra` are auto-detected:

```ts
const tables = {
	signals: {
		url: `${origin}/signals.lastra`,
		mainColumn: 'price'
	}
};
```

### By in-memory source

Use the `lastra` field instead of `parquet` to pass a `Blob`, `File`, `ArrayBuffer`, or `Uint8Array`:

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	let lastraFile = $state<File | null>(null);

	const tables = $derived(
		lastraFile
			? {
					uploaded: {
						lastra: lastraFile,
						mainColumn: 'price'
					}
				}
			: {}
	);
</script>

<input
	type="file"
	accept=".lastra"
	onchange={(event) => (lastraFile = event.currentTarget.files?.[0] ?? null)}
/>

{#if lastraFile}
	<SvelteTimeSeries table={tables} />
{/if}
```

Lastra entries support the same `columnsSelect`, `candlestick`, and `resolution` options as Parquet entries.

## Chart libraries

### ECharts (default)

```svelte
<SvelteTimeSeries {table} {markers} chartLibrary="echarts" />
```

- Built-in legend, tooltip, and data-zoom slider.
- Supports internal or external legend management.
- Series types: line and candlestick.
- Markers rendered as `MarkPoint` symbols on data series.
- Opens on the middle 10% of the data (the window the DuckDB viewport flow starts from). `TimeSeriesChart` and `SvelteTimeSeries` with arrays zoom out to all of it after the first frame; if you drive `TimeSeriesChartBuilder` yourself, call `goToZoom(0, 100)` (after the next frame) to show everything.

### TradingView Lightweight Charts

```svelte
<SvelteTimeSeries {table} {markers} chartLibrary="lightweight" />
```

- Lightweight, high-performance canvas rendering optimized for financial charts.
- Custom crosshair tooltip built in Svelte (dark-mode aware).
- No built-in legend: toggle columns from the schema panel (or your own `columnsSnippet`). `externalManagerLegend` has no effect on the chart itself; with `false`, `SvelteTimeSeries` just loads every column up front.
- Series types: line and candlestick.
- Markers rendered via the `createSeriesMarkers` plugin with native shapes (`circle`, `arrowUp`, `arrowDown`, `square`).
- Dual price scales: left scale for `%`-suffixed columns, right scale for all others.
- Time values are UTC seconds; the builder handles millisecond → second conversion automatically.
- Never draws bars closer than 0.5 px (the default `minBarSpacing` of Lightweight Charts): a chart shows at most two points per pixel of its width. With more points the first view shows the most recent ones and you scroll back; aggregate into candles (see [Performance](#performance)) when you want an overview of a long series.

#### Markers in the same second

The Lightweight Charts time axis is whole UTC seconds. The builder never drops a marker that falls in the same second as another: markers with an identical look (position, shape, color and price) are merged into one glyph labeled `×N`, and markers that look different are stacked on the bar. Every marker's text is listed in the hover tooltip. This applies to injected markers and to markers that come from the JSON column. See [Using it with data you already hold](#using-it-with-data-you-already-hold).

### Unified adapter

All three builders implement the `TimeSeriesChartAdapter` interface exported from `@qtsurfer/sveltecharts`. You can therefore instantiate any of them directly and pass it to `TimeSeriesFacade`:

```ts
import {
	LightweightTimeSeriesChartBuilder,
	TimeSeriesChartBuilder,
	type TimeSeriesChartAdapter
} from '@qtsurfer/sveltecharts';

// ECharts path
const echartsBuilder = new TimeSeriesChartBuilder(echartsInstance);

// Lightweight Charts path
const lwBuilder = new LightweightTimeSeriesChartBuilder(chartInstance);

// Both satisfy TimeSeriesChartAdapter
const adapter: TimeSeriesChartAdapter = lwBuilder;
```

## Performance

The repository's `scripts/measure-performance.mjs` draws `TimeSeriesChart` with N price points (one per second, a seeded random walk) and times it in headless Chromium: `pnpm --filter @qtsurfer/sveltecharts exec vite build && node scripts/measure-performance.mjs`. Each run is the median of five measurements after a warm-up, on a recent laptop (14-core Arm CPU) with Chromium 149 painting on the CPU. The table rounds the results, and where it shows a range the range spans three complete runs of the script on the same machine. Expect other machines to differ; compare runs made on the same one.

"painted" is the time until the picture is on screen (the next frame for Lightweight Charts, the last rendered frame for ECharts); "apply" is the part spent in JavaScript (building the data and updating the chart). Every update is a replacement of the arrays: there is no append call, so adding a point costs the same as replacing the series.

| Chart              | Points | First paint | Add or replace a series (painted) | Append 1 / 1,000 points (painted) | Memory kept: chart / + 1 series |
| ------------------ | -----: | ----------: | --------------------------------: | --------------------------------: | ------------------------------: |
| Lightweight Charts |    10k |      ~20 ms |                            ~18 ms |                            ~20 ms |                     ~12 / 14 MB |
| Lightweight Charts |    50k |  ~65–110 ms |                            ~45 ms |                        ~65–100 ms |                     ~35 / 41 MB |
| Lightweight Charts |   100k |     ~140 ms |                            ~65 ms |                       ~130–165 ms |                     ~63 / 76 MB |
| Lightweight Charts |   250k |     ~350 ms |                           ~165 ms |                           ~385 ms |                   ~145 / 178 MB |
| ECharts            |    10k |      ~33 ms |                            ~14 ms |                            ~20 ms |                     ~10 / 14 MB |
| ECharts            |    50k |      ~50 ms |                            ~33 ms |                            ~60 ms |                     ~15 / 32 MB |
| ECharts            |   100k |      ~60 ms |                            ~60 ms |                       ~105–120 ms |                     ~24 / 55 MB |
| ECharts            |   250k |     ~125 ms |                           ~135 ms |                           ~255 ms |                    ~40 / 116 MB |

- **Memory** is the JavaScript heap after a garbage collection. An update also allocates garbage while it runs (about the size of the data again, up to ~90 MB for Lightweight Charts and ~100 MB for ECharts at 100k points); the true peak cannot be sampled during synchronous work, so treat that as a rough bound. The numbers do not include the canvas.
- **Where it stops being comfortable.** Taking 100 ms for an update as the limit for smooth interaction: keep a series under **about 50k points** if it is updated every second or faster, and under **about 100k** for charts that load once or update every few seconds. Past 250k points an update takes a quarter of a second or more on either backend (Lightweight Charts needs about 1 s per update at 500k points, ECharts about 0.5 s): aggregate into candles first with `aggregateCandles`, which turns a day of one-second ticks (86,400 points) into 1,440 one-minute bars.
- **Cost grows linearly with the data and with the number of series**: every injected series of N points costs about what the price line does. Removing a series is cheap.
- ECharts paints a sampled line (LTTB), so its painting cost stays almost flat and the time goes into preparing data; Lightweight Charts draws every point it shows, but never more than one per half pixel (see [Chart libraries](#chart-libraries)).

## TimeSeriesFacade in practice

`TimeSeriesFacade` (see `src/lib/TimeSeriesFacade.ts`) encapsulates the component logic and works with any `TimeSeriesChartAdapter`:

1. **Initialization** (`initialize`) – downloads the primary column, builds the dataset, and configures legends/icons.
2. **Incremental loading** (`addDimension` / `toggleColumn`) – fetches new columns only when requested.
3. **Markers** (`loadMarkers`) – reads the `markers` view and adds annotations to the active chart backend.
4. **Observable state** (`getColumns`, `describe`, `isLoadedColumns`; `getChartAdapter().getLegendStatus()` for series visibility) – provides data for custom panels without touching DuckDB again.

Import the class directly to craft bespoke dashboards while reusing the DuckDB → Arrow → chart pipeline.

## Advanced APIs

The chart components and builders below live in `@qtsurfer/sveltecharts`. `@qtsurfer/svelte-timeseries` depends on it but only re-exports a few of its types and `aggregateCandles`, so add it (and the chart libraries it draws with) to your project to import from it directly:

```bash
pnpm add @qtsurfer/sveltecharts echarts lightweight-charts
```

### 1. SVELightweightCharts

Use this component directly when you want to manage the chart instance yourself:

```svelte
<script lang="ts">
	import { SVELightweightCharts, LightweightTimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';
	import type { IChartApi } from 'lightweight-charts';

	const onLoad = async (chart: IChartApi) => {
		const builder = new LightweightTimeSeriesChartBuilder(chart);
		builder
			// The names list includes the time column, first: one name per column of the dataset.
			.setDataset({ _ts: timestamps, price: prices }, ['_ts', 'price'])
			.addMarkerPoint(
				1,
				{ dimName: 'price', timestamp: timestamps[50], name: 'Signal' },
				{ icon: 'arrowUp', color: '#22c55e' }
			)
			.build();
	};
</script>

<SVELightweightCharts {onLoad} isDark={false} />
```

`SVELightweightCharts` props:

| Prop       | Type                                      | Description                                                                                                         |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `onLoad`   | `(chart: IChartApi) => Promise<void>`     | Called once the chart is mounted; receive the raw instance.                                                         |
| `config?`  | `{ options?: DeepPartial<ChartOptions> }` | Pass TradingView chart options (layout, grid, etc.).                                                                |
| `loading?` | `boolean`                                 | Accepted for symmetry with `SVECharts`; this component draws no overlay.                                            |
| `onClear?` | `() => void` (bindable)                   | Assigned by the component (a no-op here; `SVECharts` assigns a function that clears the chart). Bind it to call it. |
| `isDark?`  | `boolean`                                 | Applies dark palette to chart and tooltip.                                                                          |

### 2. LightweightTimeSeriesChartBuilder

Key methods (all return `this` for chaining):

| Method                               | Description                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setDataset(data, yDimensions?)`     | Initialize the chart with columnar data.                                                                                                                          |
| `addDimension(data, dimName)`        | Append a new line series dynamically.                                                                                                                             |
| `setCandlestickSeries(data, dims)`   | Draw OHLC candles from a columnar dataset, `dims` naming the open / high / low / close columns.                                                                   |
| `addMarkerPoint(id, data, options?)` | Add a marker to a series at a given timestamp. `options`: `icon` (or its alias `shape`: `'circle'`, `'arrowUp'`, `'arrowDown'`, `'square'`), `color`, `position`. |
| `toggleMarkers(id, dimName, shape)`  | Show/hide all markers for a given id + series.                                                                                                                    |
| `toggleLegend(column)`               | Show/hide a series by name.                                                                                                                                       |
| `goToZoom(start, end)`               | Set the visible range as percentages (0–100) of total time range.                                                                                                 |
| `scrollToTime(timestamp)`            | Navigate to a specific millisecond timestamp.                                                                                                                     |
| `getLegendStatus()`                  | Returns `Record<string, boolean>` (series visibility).                                                                                                            |
| `getRangeValues()`                   | Returns `[minTs, maxTs]` in milliseconds.                                                                                                                         |
| `getTotalRows()`                     | Returns total number of data points.                                                                                                                              |
| `build()`                            | Re-applies all pending options and renders the chart.                                                                                                             |

The ECharts and Lightweight Charts builders also implement `setInjectedSeries`, `setInjectedMarkers` and `setPaneHeights`; the Vela builder does not (see [Using it with data you already hold](#using-it-with-data-you-already-hold)).

### 3. DuckDB

Reuse the same instance to run bespoke SQL before/after chart rendering.

```ts
import { DuckDB } from '@qtsurfer/svelte-timeseries';

const duck = await DuckDB.create(
	{
		signal: {
			url: `${location.origin}/signals.parquet`, // absolute: DuckDB-WASM fetches it over HTTP
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
- `getSingleDimension` normalizes timestamps (ms) and returns plain `number | null` arrays ready for any chart builder.
- `DuckDBRegistry` (`src/lib/duckdb/DuckDBRegistry.ts`) auto-detects types when it registers a table (casts `%` columns to `DOUBLE`, skips helper fields, builds the `markers` view).
- `transformTableToMatrix` converts Arrow results into `[rows, columns]` matrices consumable by any UI.

Viewport reloads treat `maxPoints` as a sampling budget rather than a prefix limit. When a window exceeds the budget, DuckDB selects uniformly distributed rows across the full interval, preserving the first and last rows for budgets above one. A one-point budget selects the middle row. This deterministic policy keeps every requested column aligned, but it does not guarantee that intermediate extrema are retained. Initial loading still reads the complete primary series.

Viewport conversion resolves Arrow vectors once per column, including across record batches. It retains materialized queries on the shared DuckDB connection rather than adding streaming without query-lifecycle coordination. With `maxPoints`, the returned Arrow data and chart arrays are bounded by that budget; without it, both contain the full window. DuckDB's internal query working memory is not bounded by this output budget.

### 4. TimeSeriesChartBuilder

Craft fully custom ECharts layouts while reusing legend, marker, and metrics logic.

```ts
import { TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

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
	1,
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
4. **BTC/USDT 1-second candlestick** (`BTC_USDT_2026-04-19_h01_klines.parquet`): one hour of 1-second bars, drawn as candles because its `opn` / `hig` / `low` / `cls` columns are detected.
5. **Full dataset (10,245,084 values)**: showcases dense quantitative strategies with every column available.
6. **Synchronized markers**: active in the partial and full dataset scenarios to overlay `_m` signals on top of `price`.

The `/injected` routes of both demo apps draw arrays instead of files: a price line or candles, injected indicators in panes, markers, and a **ticks to candles** scenario that aggregates one-second ticks into bars of a length you choose.

All scenarios support both `chartLibrary="echarts"` and `chartLibrary="lightweight"`. The demo includes a selector to switch between them at runtime.

## Development & testing

```bash
pnpm ci:install
pnpm dev:ts      # demo app of @qtsurfer/svelte-timeseries
pnpm dev:charts  # demo app of @qtsurfer/sveltecharts
```

- Run `pnpm test` for the unit tests of both packages.
- Run `pnpm test:e2e` for Chromium screenshot regressions of the primary line and zoom overview. Install the browser with `pnpm exec playwright install chromium` first. Screenshots are platform-specific; update them on macOS with `pnpm test:e2e --update-snapshots` after reviewing visual changes.
- Sample Parquet files live in `packages/svelte-timeseries/static`. Adjust the demo `baseUrl` when publishing behind a CDN.
- Useful debugging helpers in `DuckDB.ts`: `closeConnection`, `getRangeData`, `getMarkers`.
- Pass `debug={true}` to measure real load times per browser.
- After changing `@qtsurfer/sveltecharts`, rebuild it (`pnpm --filter @qtsurfer/sveltecharts package`) before running the `@qtsurfer/svelte-timeseries` demo, which consumes its `dist`.
- `scripts/measure-performance.mjs` reproduces the numbers in [Performance](#performance).

## Support & contributions

- Need another scenario (streaming feeds, intraday aggregations)? Open an issue describing it.
- PRs are welcome—include reproduction steps, sample datasets, and screen captures when UI changes are involved.
- Using the component in production? Share your story so we can showcase it here.
