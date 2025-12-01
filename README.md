# qtsurfer-svelte-timeseries

![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?registry_uri=https%3A%2F%2Fregistry.npmjs.com&style=flat&logo=npm&label=QTSurfer%2Fsvelte-timeseries)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsvelte-timeseries?registry_uri=https%3A%2F%2Fregistry.npmjs.com&style=flat)](LICENSE.md)

> Professional Svelte component to explore **huge time-series datasets** directly in the browser using DuckDB-WASM, Apache Arrow, and SVECharts.

## Table of contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key features](#key-features)
4. [Installation](#installation)
5. [Getting started](#getting-started)
6. [Component API](#component-api)
7. [TimeSeriesFacade in practice](#timeseriesfacade-in-practice)
8. [Advanced APIs](#advanced-apis)
9. [Reference scenarios](#reference-scenarios)
10. [Development & testing](#development--testing)
11. [Support & contributions](#support--contributions)

## Overview

`@qtsurfer/svelte-timeseries` ships everything you need to build financial, industrial, or scientific dashboards with millions of data points. The component offers:

- Parquet/Arrow ingestion via DuckDB-WASM right in the browser.
- Columnar → ECharts transformations powered by Apache Arrow.
- Marker/event overlays synchronized with any dimension.
- Customizable side panels through Svelte snippets.

## Architecture

| Layer                   | Role                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DuckDB-WASM             | Runs SQL against Parquet without any backend and keeps data in columnar memory.                                   |
| `TimeSeriesFacade`      | Coordinates DuckDB + `TimeSeriesChartBuilder`, handles incremental column loads, and exposes UI state.            |
| `@qtsurfer/sveltecharts` | Facade that builds and updates ECharts instances declaratively.                                                   |
| SvelteKit               | Hosts the component, snippets, and demo routes.                                                                   |

## Key features

- **Browser-scale**: battle-tested with datasets above 10M values without page reloads.
- **Lazy dimensions**: additional columns download only when the user toggles them on.
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

| Prop                  | Type                                                                            | Description                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `table`               | `Record<string, { url: string; mainColumn: string; columnsSelect?: string[] }>` | Defines the Parquet sources and their primary column; the object key becomes the DuckDB view name.           |
| `markers?`            | `MarkersTableOptions`                                                           | Table and JSON column used to build the `markers` view (`shape`, `color`, `position`, `text`).               |
| `debug?`              | `boolean` (default `true`)                                                      | Enables verbose DuckDB/builder logging.                                                                      |
| `columnsSnippet?`     | `Snippet<[ColumnsProps]>`                                                       | Overrides the column toggle panel.                                                                           |
| `performanceSnippet?` | `Snippet<[PerformanceProps]>`                                                   | Overrides the performance/metrics panel.                                                                     |

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
builder.setDataset(
	{ _ts: timestamps, price: prices, ema20: ema20Series },
	['_ts', 'price', 'ema20']
);

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
