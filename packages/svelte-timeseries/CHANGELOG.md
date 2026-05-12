# @qtsurfer/svelte-timeseries

## 0.10.0

### Minor Changes

- [`1014493`](https://github.com/QTSurfer/svelte-timeseries/commit/101449338198d49ce4366e751a0a7fc46f1bc676) Thanks [@leonardojgv](https://github.com/leonardojgv)! - Add support for the Lastra binary format. Tables can now be configured with a `lastra` source (Blob, File, ArrayBuffer, Uint8Array, or URL ending in `.lastra`). The DuckDB engine is upgraded to `@duckdb/duckdb-wasm@1.33.1-dev53.0` (DuckDB v1.5.2) which publishes the community `lastra` extension for WASM.

### Patch Changes

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.10.0

## 0.9.0

### Minor Changes

- [`29add2e`](https://github.com/QTSurfer/svelte-timeseries/commit/29add2e827ac15991f42b5c6d6f72263b169681c) Thanks [@mrmx](https://github.com/mrmx)! - 💥 **Breaking:** the `snippetclass` prop on `<SvelteTimeSeries>` is renamed to `snippetClass` to match the camelCase convention already used by `containerClass` and `chartClass`. Consumers must rename the prop where they use it.

  🐛 **Fix:** `<SvelteTimeSeries>` no longer crashes with `TypeError: Cannot read properties of undefined (reading 'mainColumn')` when the `table` prop mutates during the async DuckDB initialization. The table snapshot is now captured before the `await`, and concurrent `loadChart` invocations (triggered by `chartLibrary` / `isDark` remounts or prop changes) abort safely and close any orphan DuckDB connections.

  🧹 **Internal:** introduce a `cspell`-based spellcheck (`pnpm spellcheck`) and clean up identifier typos that surfaced — `ColumsSchema` → `ColumnsSchema`, `columnesSelect` → `columnsSelect`, demo dataset field `volumen` → `volume`, and `performanceTimmer` → `performanceTimer`. None of these are part of the public API.

### Patch Changes

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.9.0

## 0.8.0

### Minor Changes

- [#101](https://github.com/QTSurfer/svelte-timeseries/pull/101) [`ae1508c`](https://github.com/QTSurfer/svelte-timeseries/commit/ae1508c84e5b3d66b35eef0064c5df39f0228c76) Thanks [@leonardojgv](https://github.com/leonardojgv)! - Add candlestick (OHLC) chart support.
  - Auto-detects OHLC columns by name (`open/_open/opn`, `high/_high/hig`, `low/_low`, `close/_close/cls`). Single-letter aliases (`o/h/l/c`) require explicit mapping to avoid false positives on unrelated parquets.
  - Explicit mapping via `candlestick: { open, high, low, close }` in table config.
  - Set `candlestick: false` to force line rendering and skip detection.
  - `resolution` option resamples raw ticks into fixed-size OHLC bars via DuckDB `time_bucket()` (e.g. `'15m'`, `'1h'`).
  - New exports: `OHLCColumns`, `OHLCResolution`, `TimeSeriesChartAdapter`, `OHLCDimensions`.
  - `TimeSeriesFacade.getChartAdapter()` returns the backend-agnostic adapter interface.
  - **Breaking**: `TimeSeriesFacade.getChartBuilder()` now returns `TimeSeriesChartBuilder | undefined` (returns `undefined` when the Lightweight Charts backend is active). Use `getChartAdapter()` for backend-agnostic access.
  - Fix: `addDimension` crashed with `Cannot read properties of undefined (reading 'push')` when called after `setCandlestickSeries`.

### Patch Changes

- Updated dependencies [[`ae1508c`](https://github.com/QTSurfer/svelte-timeseries/commit/ae1508c84e5b3d66b35eef0064c5df39f0228c76)]:
  - @qtsurfer/sveltecharts@0.8.0

## 0.7.0

### Minor Changes

- Dynamic price precision and customizable loading snippet.

  **@qtsurfer/sveltecharts**
  - Lightweight Charts backend now computes price precision per column (up to 12 decimals) instead of a hardcoded `.toFixed(4)`. Fixes display for low-value assets (e.g. `0.00000385`).
  - New exports: `getPricePrecision(values)` and `formatPreciseValue(value)`.
  - Crosshair tooltip in `SVELightweightCharts` uses `formatPreciseValue`.

  **@qtsurfer/svelte-timeseries**
  - New optional `loadingSnippet` prop on `SvelteTimeSeries` — lets consumers render a custom loader in place of the default spinner.
  - Split mixed value/type imports into explicit `import type` statements for Tailwind CSS processor compatibility.

### Patch Changes

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.7.0

## 0.6.0

### Minor Changes

- Add TradingView Lightweight Charts as a second chart backend.
  - New `chartLibrary` prop on `SvelteTimeSeries` (`'echarts' | 'lightweight'`)
  - New `LightweightTimeSeriesChartBuilder` implementing `TimeSeriesChartAdapter`
  - New `SVELightweightCharts` Svelte component with crosshair tooltip (dark mode aware)
  - New `TimeSeriesChartAdapter` interface exported from `@qtsurfer/sveltecharts`
  - New `clearMarkers()` method on both chart builders
  - New props on `SvelteTimeSeries`: `externalManagerLegend`, `isDark`, `onFacadeReady`, `markersSnippet`
  - ECharts backend improvements: UTC handling, `scrollToTime`, resize via `ResizeObserver`
  - Dev: migrated both packages to ESLint 9 flat config

### Patch Changes

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.6.0

## 0.5.0

### Minor Changes

- Add direct Parquet input support and demo improvements
  - Support passing Parquet data directly via `Blob`, `File`, `ArrayBuffer`, or `Uint8Array` (in addition to URL)
  - Add `externalManagerLegend` prop (default `true`) to control legend management
  - Auto-detect time columns named `_ts`, `ts`, `_t`, or `t`
  - Normalize timestamp handling for epoch and native timestamp types
  - Add `loadAllColumns()` to `TimeSeriesFacade` for internal legend mode
  - Demo: add custom source panel with URL/File modes, column inspection, and legend toggle
  - SVECharts: add `ResizeObserver` for dynamic resizing, configurable theme prop

### Patch Changes

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.5.0

## 0.4.5

### Patch Changes

- Expose TimeSeriesFacade via onFacadeReady callback, add getDuckDB() and getChartBuilder() accessors

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.4.5

## 0.4.4

### Patch Changes

- Fix SVECharts config reactivity bug, update DuckDB-WASM 1.30→1.32, add 30 unit tests, update deps

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.4.4

## 0.4.3

### Patch Changes

- [`2159251`](https://github.com/QTSurfer/svelte-timeseries/commit/2159251ffea839a3c6833d44ad99b7f647813916) Thanks [@mrmx](https://github.com/mrmx)! - Update dependencies: Svelte 5.55, SvelteKit 2.55, Tailwind 4.2, DaisyUI 5.5.19, Prettier 3.8, svelte-check 4.4.5

- Updated dependencies [[`2159251`](https://github.com/QTSurfer/svelte-timeseries/commit/2159251ffea839a3c6833d44ad99b7f647813916)]:
  - @qtsurfer/sveltecharts@0.4.3

## 0.4.2

### Patch Changes

- b25c78d: UI improvements: new component props (containerClass, snippetclass, chartClass, isDark), responsive grid layout, navbar with social links, dark mode support via setTheme, CI updates
- Updated dependencies [b25c78d]
  - @qtsurfer/sveltecharts@0.4.2

## 0.4.1

### Patch Changes

- ### Changes
  - Dependencies were updated.
  - Documentation was updated with installation steps.

- Updated dependencies
  - @qtsurfer/sveltecharts@0.4.1

## 0.4.0

### Minor Changes

- Preparing next release

### Patch Changes

- Updated dependencies
  - @qtsurfer/sveltecharts@0.4.0
