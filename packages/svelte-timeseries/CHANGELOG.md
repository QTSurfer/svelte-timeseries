# @qtsurfer/svelte-timeseries

## 0.15.1

### Patch Changes

- [#112](https://github.com/QTSurfer/svelte-timeseries/pull/112) [`4d96c49`](https://github.com/QTSurfer/svelte-timeseries/commit/4d96c4902ae163054a3aa110346bd7c04632375f) Thanks [@mrmx](https://github.com/mrmx)! - Make chart load failures visible and recoverable.
  - `SvelteTimeSeries` now catches a failure of the on-demand DuckDB import and of `DuckDB.create` too: it shows the load error instead of staying in the loading state forever. A failed load also clears the previous facade, columns and markers instead of leaving a stale chart behind the error.
  - `onFacadeReady` and `onChartReady` run after the load completes, so an error thrown by your callback is no longer reported as "failed to load" over a chart that did load.
  - The Vela overlay no longer stays blocked when a remount fails: the error is rethrown and the next overlay change retries the mount.

- Updated dependencies [[`4d96c49`](https://github.com/QTSurfer/svelte-timeseries/commit/4d96c4902ae163054a3aa110346bd7c04632375f)]:
  - @qtsurfer/sveltecharts@0.15.1

## 0.15.0

### Minor Changes

- [#109](https://github.com/QTSurfer/svelte-timeseries/pull/109) [`730e204`](https://github.com/QTSurfer/svelte-timeseries/commit/730e204d62b577badae9fb9f04fe91618cbcc9be) Thanks [@leonardojgv](https://github.com/leonardojgv)! - Add `@luxalgo/vela` as a third chart engine alongside ECharts and Lightweight Charts.
  - `VelaTimeSeriesChartBuilder` implements the `TimeSeriesChartAdapter` contract on top of Vela's headless core: `setCandlestickSeries`, zoom/scroll, and — via a small internal native-indicator overlay — extra line series (`addDimension`) and price-anchored markers (`addMarkerPoint`/`toggleMarkers`/`clearMarkers`), rendered on top of the candlestick. `setDataset` is not supported: Vela's market model always has a single OHLCV base series, not arbitrary multi-dimension datasets.
  - `SVEVelaCharts` is the matching Svelte wrapper (mount/resize/theme/destroy), mirroring `SVELightweightCharts`.
  - `chartLibrary="vela"` is now selectable on `SvelteTimeSeries`. A table without OHLC data still surfaces a clear, catchable error instead of crashing.

  Also fixes two long-standing correctness bugs in `TimeSeriesChartBuilder` (ECharts) that this work surfaced against a real large, sparse dataset:
  - `toggleMarkers` no longer throws when a marker was never actually placed (e.g. its value at that timestamp was `null`).
  - Markers now render visibly by default (an unset icon no longer maps to ECharts' own "draw nothing" symbol) and anchor to the closest sample with a non-null value, instead of requiring an exact timestamp match — markers come from a separate source than the series they annotate, so an exact match was never guaranteed. The equivalent fix is applied to the new Vela builder as well.

  To keep marker icons consistent across engines, the guaranteed cross-engine icon set is now `circle` / `square` / `arrowUp` / `arrowDown` / `none` (lightweight-charts' own native shape set, the narrowest of the three engines). ECharts' additional native symbols (`rect`, `roundRect`, `triangle`, `diamond`, `pin`) still render distinctly there but now collapse to `square` in Lightweight Charts instead of an inconsistent fallback. The demo app's navbar links to a new "Markers Format" page documenting this.

- [#110](https://github.com/QTSurfer/svelte-timeseries/pull/110) [`ff09687`](https://github.com/QTSurfer/svelte-timeseries/commit/ff09687156461d43da9ca3a88e7cf626cf159cd4) Thanks [@mrmx](https://github.com/mrmx)! - Draw data you already hold: price arrays, your own indicator lines and buy / sell / info markers, without DuckDB.
  - New `TimeSeriesChart` component in `@qtsurfer/sveltecharts` and matching props on `SvelteTimeSeries`: `price` (line from `times` / `values` arrays or `[time, value]` pairs), `candles` (from OHLC arrays), `injectedSeries`, `injectedMarkers` and `paneHeights`. Times are epoch milliseconds; plain arrays, typed arrays and `null` / `NaN` gaps are accepted.
  - `table` is now optional. Without it the chart is fed from the arrays and DuckDB is never loaded; with it everything works as before and the injected series and markers are drawn on top. DuckDB is now imported on demand.
  - Injected series (`name`, `times`, `values`, `color`, `lineWidth`, `lineStyle`, `pane`, `visible`) update in place: they are added, changed and removed by name without recreating the chart or moving the visible time range. `pane` places a series in its own pane (native panes on Lightweight Charts, stacked grids on ECharts) with a shared crosshair and time axis.
  - Injected markers (`buy`, `sell`, `info`, with optional `price`, `text`, `color`, `shape` and `series`) get a default look per kind, can attach to a named injected series and show their text on hover.
  - Markers in the same UTC second are no longer dropped on Lightweight Charts: markers that look alike merge into one glyph labeled `×N` (all texts stay in the tooltip) and markers that look different are stacked. This also applies to markers from the JSON column.
  - Markers now render on candlestick series on both backends.
  - `TimeSeriesChartAdapter` gains the optional `setInjectedSeries`, `setInjectedMarkers`, `setPaneHeights` and `capabilities` members. New exported types: `InjectedSeries`, `InjectedMarker`, `PriceLineInput`, `CandlesInput`, `NumericArray`, `ChartCapabilities` and related.
  - `SvelteTimeSeries` gains `onChartReady`, and its `debug` prop is now optional.

- [#110](https://github.com/QTSurfer/svelte-timeseries/pull/110) [`ff09687`](https://github.com/QTSurfer/svelte-timeseries/commit/ff09687156461d43da9ca3a88e7cf626cf159cd4) Thanks [@mrmx](https://github.com/mrmx)! - Vela next to the arrays entry, injected series and injected markers.
  - `TimeSeriesChart` (and `SvelteTimeSeries` without a `table`) accepts `chartLibrary="vela"` for `candles`. Vela is loaded on demand there, so the other engines never download it. A `price` line is rejected with a visible message.
  - The Vela builder declares its `capabilities` (all `false`): it does not draw injected series, injected markers or panes. The components now log one warning per ignored input (`injectedSeries`, `injectedMarkers`, `paneHeights`) instead of dropping it silently. New export `describeUnsupportedInput(adapter, engine, input)` returns those messages.
  - A marker's target column in an OHLC table is no longer loaded as an extra line when it is one of open / high / low / close: the markers stay on the candles on every engine.
  - An unset marker icon draws a circle on Lightweight Charts too (it was a square), as on ECharts and Vela.
  - `clearMarkers()` on ECharts leaves the injected markers alone, as on Lightweight Charts.

### Patch Changes

- Updated dependencies [[`730e204`](https://github.com/QTSurfer/svelte-timeseries/commit/730e204d62b577badae9fb9f04fe91618cbcc9be), [`ff09687`](https://github.com/QTSurfer/svelte-timeseries/commit/ff09687156461d43da9ca3a88e7cf626cf159cd4), [`ff09687`](https://github.com/QTSurfer/svelte-timeseries/commit/ff09687156461d43da9ca3a88e7cf626cf159cd4)]:
  - @qtsurfer/sveltecharts@0.15.0

## 0.14.4

### Patch Changes

- Updated dependencies [[`75789ef`](https://github.com/QTSurfer/svelte-timeseries/commit/75789efba38a67f1f4d6bfbf3dbccf0ec186739d)]:
  - @qtsurfer/sveltecharts@0.14.4

## 0.14.3

### Patch Changes

- Updated dependencies [[`b74c764`](https://github.com/QTSurfer/svelte-timeseries/commit/b74c764bbe15abdccba706580cddecd08136d7df)]:
  - @qtsurfer/sveltecharts@0.14.3

## 0.14.2

### Patch Changes

- Display the decimal precision of small time-series values.

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.14.2

## 0.14.1

### Patch Changes

- Fix sparse-line rendering and keep the viewport overview stable.

- Updated dependencies []:
  - @qtsurfer/sveltecharts@0.14.1

## 0.14.0

### Minor Changes

- Improve viewport sampling, candle aggregation, sparse series and timestamp handling.

## 0.13.0

### Minor Changes

- [`443f9fc`](https://github.com/QTSurfer/svelte-timeseries/commit/443f9fcec0225abad55ce945d75d536ae7825099) Thanks [@mrmx](https://github.com/mrmx)! - Support raw numeric epoch timestamp units per table.

### Patch Changes

- Updated dependencies [[`443f9fc`](https://github.com/QTSurfer/svelte-timeseries/commit/443f9fcec0225abad55ce945d75d536ae7825099)]:
  - @qtsurfer/sveltecharts@0.13.0

## 0.10.1

### Patch Changes

- [#104](https://github.com/QTSurfer/svelte-timeseries/pull/104) [`b2cd719`](https://github.com/QTSurfer/svelte-timeseries/commit/b2cd719c67514b575f49e6b69792a44acfb7c986) Thanks [@mrmx](https://github.com/mrmx)! - Fix Tailwind v4 incorrectly parsing distributed Svelte files as CSS.

  `SVECharts.svelte`: moved `init` and `use` echarts imports and component registration into a separate `echartsSetup.ts` module so the `.svelte` file no longer contains destructured imports that Tailwind's CSS parser misreads as CSS declarations.

  `SvelteTimeSeries.svelte`: added an empty `<script lang="ts" module>` block so Tailwind v4 recognizes the file as a Svelte component instead of treating the entire file as a CSS document.

- Updated dependencies [[`b2cd719`](https://github.com/QTSurfer/svelte-timeseries/commit/b2cd719c67514b575f49e6b69792a44acfb7c986)]:
  - @qtsurfer/sveltecharts@0.10.1

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
