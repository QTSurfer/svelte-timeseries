# @qtsurfer/svelte-timeseries

[![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?label=version&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![npm downloads](https://img.shields.io/npm/dt/%40qtsurfer%2Fsvelte-timeseries?label=downloads&style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsvelte-timeseries?style=flat-square)](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)

> Professional Svelte component to explore **huge time-series datasets** directly in the browser using DuckDB-WASM, Apache Arrow, ECharts, and TradingView Lightweight Charts.
>
> **[Live Demo](https://qtsurfer.github.io/svelte-timeseries)** | **[npm](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries)**

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key features](#key-features)
4. [Installation](#installation)
5. [Getting started](#getting-started)
6. [Component API](#component-api)
7. [Candlestick & OHLC](#candlestick--ohlc)
8. [Chart libraries](#chart-libraries)
9. [TimeSeriesFacade in practice](#timeseriesfacade-in-practice)
10. [Advanced APIs](#advanced-apis)
11. [Reference scenarios](#reference-scenarios)
12. [Development & testing](#development--testing)
13. [Support & contributions](#support--contributions)

## Overview

`@qtsurfer/svelte-timeseries` ships everything you need to build financial, industrial, or scientific dashboards with millions of data points. The component offers:

- Parquet/Arrow ingestion via DuckDB-WASM right in the browser.
- Columnar → chart transformations powered by Apache Arrow.
- Marker/event overlays synchronized with any dimension.
- Customizable side panels through Svelte snippets.
- Switchable chart backends: **ECharts** or **TradingView Lightweight Charts** via a single prop.

## Architecture

| Layer                    | Role                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| DuckDB-WASM              | Runs SQL against Parquet without any backend and keeps data in columnar memory.                                                            |
| `TimeSeriesFacade`       | Coordinates DuckDB + chart builder, handles incremental column loads, and exposes UI state.                                                |
| `@qtsurfer/sveltecharts` | Provides `SVECharts` (ECharts) and `SVELightweightCharts` (TradingView) components plus their respective builders behind a unified adapter. |
| SvelteKit                | Hosts the component, snippets, and demo routes.                                                                                            |

## Key features

- **Browser-scale**: battle-tested with datasets above 10M values without page reloads.
- **Lazy dimensions**: additional columns download only when the user toggles them on.
- **Native markers**: trading signals, alerts, or annotations rendered with custom icons and colors.
- **Dual chart backends**: switch between ECharts and TradingView Lightweight Charts with `chartLibrary="lightweight"`.
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
- Ability to serve Parquet/Arrow files (local assets or CDN).

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

<SvelteTimeSeries table={tables} {markers} debug={false} />
```

## Component API

| Prop                     | Type                                                                            | Description                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `table`                  | `Record<string, { url: string; mainColumn: string; columnsSelect?: string[] }>` | Defines the Parquet sources and their primary column; the object key becomes the DuckDB view name. |
| `markers?`               | `MarkersTableOptions`                                                           | Table and JSON column used to build the `markers` view (`shape`, `color`, `position`, `text`).     |
| `debug?`                 | `boolean` (default `true`)                                                      | Enables verbose DuckDB/builder logging.                                                            |
| `chartLibrary?`          | `'echarts' \| 'lightweight'` (default `'echarts'`)                              | Selects the chart backend. `'lightweight'` renders via TradingView Lightweight Charts.             |
| `externalManagerLegend?` | `boolean` (default `true`)                                                      | When `true`, legend management is handled by external snippets instead of the chart library.       |
| `isDark?`                | `boolean`                                                                       | Passes dark-mode state to the chart component for theme-aware styling.                             |
| `onFacadeReady?`         | `(facade: TimeSeriesFacade) => void`                                            | Called once the facade is initialized; useful for programmatic access to the facade.               |
| `columnsSnippet?`        | `Snippet<[ColumnsProps]>`                                                       | Overrides the column toggle panel.                                                                 |
| `markersSnippet?`        | `Snippet<[MarkersProps]>`                                                       | Overrides the markers panel (receives `markers`, `goToMarker`, `toggleMarker`).                    |
| `performanceSnippet?`    | `Snippet<[PerformanceProps]>`                                                   | Overrides the performance/metrics panel.                                                           |
| `containerClass?`        | `string`                                                                        | CSS classes applied to the outer container element.                                                |
| `chartClass?`            | `string`                                                                        | CSS classes applied to the inner chart element.                                                    |

## Candlestick & OHLC

### Auto-detection

When a Parquet file contains columns whose names match known OHLC patterns, the component automatically renders a candlestick series without any extra configuration:

| Role  | Recognized column names    |
| ----- | -------------------------- |
| open  | `open`, `_open`, `opn`     |
| high  | `high`, `_high`, `hig`     |
| low   | `low`, `_low`              |
| close | `close`, `_close`, `cls`   |

Single-letter column names (`o`, `h`, `l`, `c`) are **not** auto-detected — they collide too often with unrelated columns in non-financial parquets. Use the [explicit mapping](#explicit-mapping) below to opt into them.

### Explicit mapping

Pass a `candlestick` object to override auto-detection with exact column names:

```ts
const tables = {
  btc: {
    url: '/BTC_USDT_h01_klines.parquet',
    mainColumn: 'cls',
    candlestick: {
      open:  'opn',
      high:  'hig',
      low:   'low',
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
    url: '/BTC_USDT_h01_klines.parquet',
    mainColumn: 'cls',
    candlestick: false
  }
};
```

### Resampling

Use `resolution` to resample raw tick data into OHLC bars of a fixed size via DuckDB's `time_bucket()`. The format is `<number><unit>` where unit is `s` (seconds), `m` (minutes), `h` (hours), or `d` (days):

```ts
const tables = {
  ticks: {
    url: '/ticks.parquet',
    mainColumn: 'price',
    resolution: '15m'   // aggregate raw ticks into 15-minute candles
  }
};
```

Valid examples: `'15s'`, `'1m'`, `'5m'`, `'15m'`, `'1h'`, `'4h'`, `'1d'`.

When `resolution` is set, DuckDB computes `open = FIRST`, `high = MAX`, `low = MIN`, `close = LAST` for each bucket.

### TableData reference

```ts
type OHLCColumns = {
  open:  string;
  high:  string;
  low:   string;
  close: string;
};

type OHLCResolution = `${number}${'s' | 'm' | 'h' | 'd'}`;

// All OHLC fields live inside each table entry:
{
  url: string;          // remote Parquet URL
  // — or —
  parquet: BinarySource; // Blob | ArrayBuffer | Uint8Array

  mainColumn: string;
  columnsSelect?: string[];

  candlestick?: OHLCColumns | false;  // explicit map, or false to disable
  resolution?:  OHLCResolution;       // resampling bucket size
}
```

## Chart libraries

### ECharts (default)

```svelte
<SvelteTimeSeries {table} {markers} chartLibrary="echarts" />
```

- Built-in legend, tooltip, and data-zoom slider.
- Supports internal or external legend management.
- Series types: line, bar, etc.
- Markers rendered as `MarkPoint` symbols on data series.

### TradingView Lightweight Charts

```svelte
<SvelteTimeSeries {table} {markers} chartLibrary="lightweight" />
```

- Lightweight, high-performance canvas rendering optimized for financial charts.
- Custom crosshair tooltip built in Svelte (dark-mode aware).
- External legend management required (`externalManagerLegend` is always `true`).
- Series type: line only.
- Markers rendered via the `createSeriesMarkers` plugin with native shapes (`circle`, `arrowUp`, `arrowDown`, `square`).
- Dual price scales: left scale for `%`-suffixed columns, right scale for all others.
- Time values are UTC seconds; the builder handles millisecond → second conversion automatically.

#### Marker deduplication

Lightweight Charts collapses markers that share the same UTC second on a series. The builder silently discards duplicates to prevent rendering artifacts.

### Unified adapter

Both backends implement the `TimeSeriesChartAdapter` interface exported from `@qtsurfer/sveltecharts`. You can therefore instantiate either builder directly and pass it to `TimeSeriesFacade`:

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

## TimeSeriesFacade in practice

`TimeSeriesFacade` (see `src/lib/TimeSeriesFacade.ts`) encapsulates the component logic and works with any `TimeSeriesChartAdapter`:

1. **Initialization** (`initialize`) – downloads the primary column, builds the dataset, and configures legends/icons.
2. **Incremental loading** (`addDimension` / `toggleColumn`) – fetches new columns only when requested.
3. **Markers** (`loadMarkers`) – reads the `markers` view and adds annotations to the active chart backend.
4. **Observable state** (`getColumns`, `describe`, `getLegendStatus`) – provides data for custom panels without touching DuckDB again.

Import the class directly to craft bespoke dashboards while reusing the DuckDB → Arrow → chart pipeline.

## Advanced APIs

### 1. SVELightweightCharts

Use this component directly when you want to manage the chart instance yourself:

```svelte
<script lang="ts">
  import { SVELightweightCharts, LightweightTimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';
  import type { IChartApi } from 'lightweight-charts';

  const onLoad = async (chart: IChartApi) => {
    const builder = new LightweightTimeSeriesChartBuilder(chart);
    builder
      .setDataset({ _ts: timestamps, price: prices }, ['price'])
      .addMarkerPoint(1, { dimName: 'price', timestamp: timestamps[50], name: 'Signal' }, { shape: 'arrowUp', color: '#22c55e' })
      .build();
  };
</script>

<SVELightweightCharts {onLoad} isDark={false} />
```

`SVELightweightCharts` props:

| Prop       | Type                               | Description                                               |
| ---------- | ---------------------------------- | --------------------------------------------------------- |
| `onLoad`   | `(chart: IChartApi) => Promise<void>` | Called once the chart is mounted; receive the raw instance. |
| `config?`  | `{ options?: DeepPartial<ChartOptions> }` | Pass TradingView chart options (layout, grid, etc.).   |
| `loading?` | `boolean`                          | Shows a loading overlay.                                  |
| `onClear?` | `() => void`                       | Called before the chart is destroyed on unmount.          |
| `isDark?`  | `boolean`                          | Applies dark palette to chart and tooltip.                |

### 2. LightweightTimeSeriesChartBuilder

Key methods (all return `this` for chaining):

| Method | Description |
| --- | --- |
| `setDataset(data, yDimensions?)` | Initialize the chart with columnar data. |
| `addDimension(data, dimName)` | Append a new line series dynamically. |
| `addMarkerPoint(id, data, options?)` | Add a marker to a series at a given timestamp. |
| `toggleMarkers(id, dimName, shape)` | Show/hide all markers for a given id + series. |
| `toggleLegend(column)` | Show/hide a series by name. |
| `goToZoom(start, end)` | Set the visible range as percentages (0–100) of total time range. |
| `scrollToTime(timestamp)` | Navigate to a specific millisecond timestamp. |
| `getLegendStatus()` | Returns `Record<string, boolean>` (series visibility). |
| `getRangeValues()` | Returns `[minTs, maxTs]` in milliseconds. |
| `getTotalRows()` | Returns total number of data points. |
| `build()` | Re-applies all pending options and renders the chart. |

### 3. DuckDB

Reuse the same instance to run bespoke SQL before/after chart rendering.

```ts
import { DuckDB } from "@qtsurfer/svelte-timeseries";

const duck = await DuckDB.create(
  {
    signal: {
      url: "/signals.parquet",
      mainColumn: "price",
    },
  },
  undefined,
  true,
);

const rows = await duck.getRangeData(
  "signal",
  "2024-01-01",
  "2024-01-31",
  1000,
);
await duck.closeConnection();
```

Key implementations (`src/lib/duckdb/DuckDB.ts`):

- `DuckDB.create` validates `window + Worker`, registers Parquet views, and reports load time.
- `getSingleDimension` normalizes timestamps (ms) and returns Arrow arrays ready for any chart builder.
- `buildTablesAndSchemas` auto-detects types (casts `%` columns to `DOUBLE`, skips helper fields, builds the `markers` view).
- `transformTableToMatrix` converts Arrow results into `[rows, columns]` matrices consumable by any UI.

### 4. TimeSeriesChartBuilder

Craft fully custom ECharts layouts while reusing legend, marker, and metrics logic.

```ts
import { TimeSeriesChartBuilder } from "@qtsurfer/sveltecharts";

const builder = new TimeSeriesChartBuilder(echartsInstance, {
  externalManagerLegend: true,
});

builder.setLegendIcon("circle");
builder.setDataset({ _ts: timestamps, price: prices, ema20: ema20Series }, [
  "_ts",
  "price",
  "ema20",
]);

builder.addMarkerPoint(
  1,
  { dimName: "price", timestamp: timestamps[100], name: "Breakout" },
  { icon: "pin", color: "#FF7F50" },
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

All scenarios support both `chartLibrary="echarts"` and `chartLibrary="lightweight"`. The demo includes a selector to switch between them at runtime.

## Development & testing

```bash
pnpm ci:install
pnpm dev --filter svelte-timeseries
```

- Sample Parquet files live in `packages/svelte-timeseries/static`. Adjust the demo `baseUrl` when publishing behind a CDN.
- Useful debugging helpers in `DuckDB.ts`: `closeConnection`, `getRangeData`, `getMarkers`.
- Pass `debug={true}` to measure real load times per browser.

## Support & contributions

- Need another scenario (streaming feeds, intraday aggregations)? Open an issue describing it.
- PRs are welcome—include reproduction steps, sample datasets, and screen captures when UI changes are involved.
- Using the component in production? Share your story so we can showcase it here.
