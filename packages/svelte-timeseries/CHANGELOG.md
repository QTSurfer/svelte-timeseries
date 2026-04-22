# @qtsurfer/svelte-timeseries

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
