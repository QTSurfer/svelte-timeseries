# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo containing two main packages:
1. `@qtsurfer/svelte-timeseries` - Main Svelte component for time-series visualization
2. `@qtsurfer/sveltecharts` - ECharts integration layer for Svelte

The project enables visualization of huge time-series datasets directly in the browser using DuckDB-WASM, Apache Arrow, and ECharts.

## Key Architecture Components

### Core Layers
1. **DuckDB-WASM** - Runs SQL against Parquet files in the browser without backend
2. **TimeSeriesFacade** - Coordinates DuckDB + TimeSeriesChartBuilder, handles incremental column loads
3. **@qtsurfer/sveltecharts** - Svelte component that builds and updates ECharts instances declaratively
4. **SvelteKit** - Hosts the component and demo routes

### Main Entry Points
- `packages/svelte-timeseries/src/lib/component/SvelteTimeSeries.svelte` - Main component
- `packages/svelte-timeseries/src/lib/TimeSeriesFacade.ts` - Core coordination logic
- `packages/svelte-timeseries/src/lib/duckdb/DuckDB.ts` - DuckDB wrapper
- `packages/sveltecharts/src/lib/TimeSeriesChartBuilder.ts` - ECharts builder

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
```

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
- JSON column in Parquet stores marker definitions
- Rendered as annotations on ECharts
- Customizable icons, colors, and positions

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
│   │   │   ├── component/     # Svelte components
│   │   │   ├── duckdb/        # DuckDB integration
│   │   │   └── index.ts       # Public exports
│   │   └── routes/            # Demo routes
│   └── static/                # Sample Parquet files
└── sveltecharts/             # ECharts integration
    ├── src/
    │   ├── lib/               # Core ECharts logic
    │   └── routes/            # Demo routes
```

## Data Flow

1. **Initialization**: SvelteTimeSeries creates DuckDB instance and TimeSeriesChartBuilder
2. **Data Loading**: TimeSeriesFacade initializes with primary column via `getSingleDimension()`
3. **Rendering**: TimeSeriesChartBuilder sets dataset and creates ECharts configuration
4. **Interaction**: User actions trigger lazy loading of additional columns
5. **Updates**: Chart updates via ECharts `setOption()` with incremental data

## Sample Parquet Files

Located in `packages/svelte-timeseries/static/`:
- `temps_gzip_mini.parquet` - Minimal dataset for testing
- `temps_gzip.parquet` - 1M rows performance test
- Larger datasets for full-scale testing

Adjust the demo `baseUrl` when publishing behind a CDN.