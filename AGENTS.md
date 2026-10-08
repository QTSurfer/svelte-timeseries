# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

This is a monorepo containing two main packages:
1. `@qtsurfer/svelte-timeseries` - Main Svelte component for time-series visualization
2. `@qtsurfer/sveltecharts` - Chart integration layer for Svelte (ECharts + TradingView Lightweight Charts)

The project enables visualization of huge time-series datasets directly in the browser using DuckDB-WASM, Apache Arrow, ECharts, and TradingView Lightweight Charts.

## Key Architecture Components

### Core Layers
1. **DuckDB-WASM** - Runs SQL against Parquet files in the browser without backend
2. **TimeSeriesFacade** - Coordinates DuckDB + chart builder (via `TimeSeriesChartAdapter`), handles incremental column loads
3. **@qtsurfer/sveltecharts** - Svelte components and builders for ECharts and TradingView Lightweight Charts
4. **SvelteKit** - Hosts the component and demo routes

### Chart Backends
- **ECharts** (`SVECharts` + `TimeSeriesChartBuilder`) - Default backend; full-featured with built-in legend, tooltip, zoom slider
- **TradingView Lightweight Charts** (`SVELightweightCharts` + `LightweightTimeSeriesChartBuilder`) - Performance-focused canvas renderer; custom Svelte tooltip, external legend required
- Both implement `TimeSeriesChartAdapter`; `TimeSeriesFacade` is agnostic to the backend

### Main Entry Points
- `packages/svelte-timeseries/src/lib/component/SvelteTimeSeries.svelte` - Main component (prop `chartLibrary` selects backend)
- `packages/svelte-timeseries/src/lib/TimeSeriesFacade.ts` - Core coordination logic
- `packages/svelte-timeseries/src/lib/duckdb/DuckDB.ts` - DuckDB wrapper
- `packages/sveltecharts/src/lib/TimeSeriesChartBuilder.ts` - ECharts builder
- `packages/sveltecharts/src/lib/LightweightTimeSeriesChartBuilder.ts` - Lightweight Charts builder
- `packages/sveltecharts/src/lib/chartAdapter.ts` - `TimeSeriesChartAdapter` interface
- `packages/sveltecharts/src/lib/TimeSeriesChart.svelte` - Arrays entry point (price/candles + injected series and markers, no DuckDB)

## Common Development Commands

### Installation
```bash
pnpm ci:install
```

### Development
```bash
# Start development server for svelte-timeseries
pnpm dev:ts

# Start development server for sveltecharts
pnpm dev:charts

# Run both in parallel
pnpm dev
```

### Building
```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @qtsurfer/svelte-timeseries build
pnpm --filter @qtsurfer/sveltecharts build
```

### Testing & Quality
```bash
# Run checks
pnpm check

# Run linter
pnpm lint

# Format code
pnpm format

# Spellcheck (cSpell)
pnpm spellcheck
```

`spellcheck` runs cSpell against `packages/**/src/**`. The project dictionary lives in `cspell-project-words.txt` at the repo root — add domain-specific words there rather than disabling cSpell inline.

### Publishing
```bash
# Version packages
pnpm changeset:version

# Publish to npm
pnpm changeset:publish
```

## Key Development Concepts

### Lazy Loading
- Primary column loads initially
- Additional columns download only when toggled on
- Uses `toggleColumn()` method in TimeSeriesFacade

### Markers System
- Two sources: the JSON column in Parquet (`addMarkerPoint`) and the `injectedMarkers` input (`setInjectedMarkers`, buy/sell/info, see below)
- **ECharts**: rendered as `MarkPoint` symbols on data series (icons: `arrowUp`, `arrowDown`, `circle`, `pin`, etc.); injected markers live on a helper series per host series so the host can stay `silent`
- **Lightweight Charts**: rendered via `createSeriesMarkers` plugin (shapes: `circle`, `arrowUp`, `arrowDown`, `square`); one plugin per series (created lazily for the candlestick and injected series), fed from both sources
- Markers sharing a UTC second are never dropped (`groupMarkers` in `injectedMarkers.ts`): identical looks (position, shape, color, price) merge into one glyph labeled `×N` and keep every text for the tooltip; different looks stay separate and are stacked (natively by Lightweight Charts, by pixel offset on ECharts)
- Markers on candlesticks work on both backends: OHLC column names resolve to the candlestick series
- Customizable colors, positions (`aboveBar`, `belowBar`, `inBar`, and `atPrice*` when a price is given), and text labels

### Injected Series & Markers (arrays input)
- Inputs: `price` / `candles` (arrays, no DuckDB), `injectedSeries`, `injectedMarkers`, `paneHeights`; same props on `TimeSeriesChart` (sveltecharts) and `SvelteTimeSeries`
- Time unit is epoch **milliseconds** everywhere; values accept `number[]`, typed arrays and `null`/`NaN` gaps
- Declarative and incremental: `setInjectedSeries` / `setInjectedMarkers` / `setPaneHeights` are optional members of `TimeSeriesChartAdapter`; the builder diffs by series name (array identity + length, never a value scan), so updates add/update/remove in place, never rebuild the chart and keep the visible range. Backends advertise support through the optional `capabilities` object
- Panes: `InjectedSeries.pane` (0 = price pane) is mapped to consecutive panes. Lightweight Charts uses native panes (`paneIndex`, stretch factors); ECharts stacks grids (`buildPaneLayout`) and replaces the grid/axis components only when the pane count changes
- Pure, unit-tested logic lives in `seriesInput.ts`, `injectedMarkers.ts`, `priceInput.ts` and `echartsInjected.ts`; builders only wire it to a chart instance
- Marker hover: Lightweight Charts resolves it from the crosshair (the bar under the cursor, binary search on sorted markers) through `chartHooks.ts`, which `SVELightweightCharts` reads; ECharts shows an overlay on `mouseover` of a mark point (its axis tooltip would otherwise take precedence)
- `SvelteTimeSeries` loads DuckDB only for a non-empty `table` (dynamic import in `loadChart`, decision in `dataSource.ts`); arrays-only charts never start it. Keep it that way: no static value import of `DuckDB` in the component

### Svelte & Runtime
- **Svelte 5** (`^5.43.14`) with runes API (`$state`, `$derived`, `$effect`, etc.)
- **ECharts 6** (`^6.0.0`)
- **TradingView Lightweight Charts 5** (`^5.1.0`) — uses `createSeriesMarkers` plugin for marker rendering
- Do NOT use legacy Svelte 4 reactive syntax (`$:`, `export let`, stores)

### Performance Features
- Columnar data processing with Apache Arrow
- ECharts sampling and progressive rendering
- DuckDB query optimizations
- Debug mode for performance monitoring

## Package Structure

```
packages/
├── svelte-timeseries/     # Main component package
│   ├── src/
│   │   ├── lib/
│   │   │   ├── component/     # Svelte components (SvelteTimeSeries)
│   │   │   ├── duckdb/        # DuckDB integration
│   │   │   ├── dataSource.ts  # table vs arrays decision (DuckDB only for a table)
│   │   │   └── index.ts       # Public exports
│   │   └── routes/            # Demo routes
│   └── static/                # Sample Parquet files
└── sveltecharts/             # Chart integration (ECharts + Lightweight Charts)
    ├── src/
    │   ├── lib/
    │   │   ├── SVECharts.svelte                       # ECharts component
    │   │   ├── SVELightweightCharts.svelte            # TradingView component
    │   │   ├── TimeSeriesChart.svelte                 # Arrays entry point (no DuckDB)
    │   │   ├── TimeSeriesChartBuilder.ts              # ECharts builder
    │   │   ├── LightweightTimeSeriesChartBuilder.ts   # Lightweight Charts builder
    │   │   ├── chartAdapter.ts                        # TimeSeriesChartAdapter interface
    │   │   ├── seriesInput.ts / injectedMarkers.ts    # Injected series & markers: pure logic
    │   │   ├── priceInput.ts / echartsInjected.ts     # Arrays -> dataset, ECharts option fragments
    │   │   ├── chartHooks.ts                          # Builder -> tooltip hooks (Lightweight Charts)
    │   │   └── types.ts                               # Shared types
    │   └── routes/            # Demo routes
```

## Data Flow

1. **Initialization**: SvelteTimeSeries selects chart component based on `chartLibrary` prop and creates a DuckDB instance
2. **Data Loading**: TimeSeriesFacade initializes with primary column via `getSingleDimension()`
3. **Rendering**: Active chart builder (`TimeSeriesChartBuilder` or `LightweightTimeSeriesChartBuilder`) sets dataset and renders
4. **Interaction**: User actions trigger lazy loading of additional columns via `TimeSeriesChartAdapter`
5. **Updates**: ECharts path uses incremental `setOption()`; Lightweight Charts path replaces series data directly

---

## Agent Rules (MANDATORY)

Agents must:

- Preserve public APIs unless explicitly instructed
- Prefer minimal, localized diffs
- Run `pnpm check` and `pnpm build` after implementing changes, before proposing them
- Preserve lazy loading architecture
- Keep clear separation between:
  - DuckDB layer
  - Facade logic
  - Chart rendering
  - UI components
- Assume browser-only runtime (no Node APIs)
- Avoid unnecessary memory materialization
- Maintain incremental chart updates

Agents must NOT:

- Add backend services
- Replace DuckDB
- Replace ECharts or Lightweight Charts with a different charting library
- Remove facade pattern or `TimeSeriesChartAdapter` interface
- Load full datasets eagerly
- Introduce blocking UI work

---

## Development Workflow for Agents

When implementing a change:

1. Identify affected package(s)
2. Implement modification
3. Update demo routes if behavior changes
4. Validate:
```bash
pnpm check
pnpm build
pnpm spellcheck
```
5. Verify:

- Component renders correctly
- Lazy loading still functions
- Chart updates incrementally
- No full re-render regressions

---

## Testing Expectations

Pure logic and both builders have vitest suites in `packages/*/tests/un` (`pnpm test`); `pnpm test:e2e` runs the Playwright checks in `tests/e2e`. Rendering is still verified manually via the demo routes (`pnpm dev:ts`, `pnpm dev:charts`), including `/injected` in both apps.

After changing `@qtsurfer/sveltecharts`, rebuild it (`pnpm --filter @qtsurfer/sveltecharts package`) before running or checking `@qtsurfer/svelte-timeseries`, which consumes its `dist`.

All changes must preserve:

- Rendering with `temps_gzip_mini.parquet`
- Lazy column toggle behavior
- Progressive rendering performance
- Incremental ECharts updates
- Marker rendering behavior

---

## Refactoring Guidelines

Allowed:

- Extract pure TypeScript logic
- Improve structure and readability
- Improve type safety
- Reduce coupling

Not allowed:

- Breaking public exports
- Removing facade layer
- Mixing DuckDB and UI logic
- Heavy synchronous UI work

---

## Performance Constraints (CRITICAL)

This system is performance-sensitive.

Agents must ensure:

- No full Arrow table materialization unless required
- Prefer incremental / streaming queries
- No UI thread blocking
- Preserve ECharts progressive rendering
- Avoid unnecessary memory copies

---

## Tooling Context

- Package manager: pnpm (workspace aware)
- Monorepo filtering required
- DuckDB runs in WASM
- Browser-only execution
- ECharts updates must use incremental `setOption()`

---

## Common Agent Tasks
Add new column visualization:
1. Extend TimeSeriesFacade toggle logic
2. Extend both `TimeSeriesChartBuilder` and `LightweightTimeSeriesChartBuilder` series config
3. Ensure lazy loading query
4. Verify incremental chart update on both backends

Add marker type:
1. Extend marker schema
2. Add renderer in both chart builders (ECharts MarkPoint + Lightweight createSeriesMarkers)
3. Validate overlay rendering on both backends

Extend injected series or markers:
1. Change the pure logic first (`seriesInput.ts` / `injectedMarkers.ts`) and its tests
2. Wire it in both builders; keep new `TimeSeriesChartAdapter` members optional and report them in `capabilities`
3. Check `/injected` in both demo apps on both backends: chart not recreated on updates, visible range kept

Modify query logic:
1. Update DuckDB wrapper
2. Preserve Arrow compatibility
3. Maintain incremental data loading

---

## Decision Policy When Uncertain

Prefer:
- Minimal change
- Architectural preservation
- Performance safety