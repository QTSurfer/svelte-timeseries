# @qtsurfer/sveltecharts

![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsveltecharts?label=version&style=flat-square)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsveltecharts?style=flat-square)](https://npmjs.com/package/@qtsurfer/sveltecharts)

> Svelte 5 component for declarative [Apache ECharts](https://echarts.apache.org/) time-series charts with built-in data zoom, markers, and progressive rendering.

## Table of contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick start](#quick-start)
4. [SVECharts component API](#svecharts-component-api)
5. [TimeSeriesChartBuilder](#timeserieschartbuilder)
6. [Data formats](#data-formats)
7. [Markers and annotations](#markers-and-annotations)
8. [Development](#development)

## Overview

`@qtsurfer/sveltecharts` provides two main exports:

- **`SVECharts`** — A Svelte 5 component that initializes and manages an ECharts instance with automatic resize handling, dark mode support, and data zoom events.
- **`TimeSeriesChartBuilder`** — A fluent builder class that configures ECharts options for time-series data, including dataset management, series creation, legend control, markers, and incremental updates.

The package uses ECharts tree-shaking to register only the required components: `LineChart`, `BarChart`, `DataZoomComponent`, `LegendComponent`, `TooltipComponent`, `GridComponent`, `DatasetComponent`, `MarkLineComponent`, `MarkPointComponent`, `MarkAreaComponent`, `CanvasRenderer`, and `LabelLayout`.

## Installation

```bash
pnpm add @qtsurfer/sveltecharts echarts
# or
npm install @qtsurfer/sveltecharts echarts
```

Peer dependencies:

- `svelte` ^5.43.14
- `echarts` ^6.0.0

## Quick start

```svelte
<script lang="ts">
	import { SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';
	import type { ECharts } from '@qtsurfer/sveltecharts';

	async function handleLoad(instance: ECharts) {
		const builder = new TimeSeriesChartBuilder(instance);

		builder.setDataset(
			{
				_ts: [1700000000000, 1700003600000, 1700007200000],
				price: [100.5, 101.2, 99.8]
			},
			['time', 'price']
		);
	}
</script>

<SVECharts onLoad={handleLoad} />
```

## SVECharts component API

| Prop         | Type                                  | Default   | Description                                                     |
| ------------ | ------------------------------------- | --------- | --------------------------------------------------------------- |
| `onLoad`     | `(instance: ECharts) => Promise<void>` | required  | Callback fired after the ECharts instance is initialized.       |
| `config`     | `Partial<EChartsConfig>`              | `{}`      | Override theme, renderer (`'canvas'` or `'svg'`), or initial option. |
| `onDataZoom` | `(event: DataZoomEventSingle) => void` | —         | Callback for data zoom interactions (scroll, slider).           |
| `loading`    | `boolean` (bindable)                  | `false`   | Controls the loading state.                                     |
| `onClear`    | `() => void` (bindable)               | —         | Bound to `instance.clear()` after initialization.               |
| `isDark`     | `boolean`                             | `false`   | Toggles dark mode background.                                   |

### EChartsConfig

```ts
type EChartsConfig = {
	theme?: string | object;
	renderer?: 'canvas' | 'svg';
	option: EChartsOption;
};
```

## TimeSeriesChartBuilder

Fluent builder for time-series ECharts configurations. Handles dataset, series, legends, tooltips, zoom, and markers.

### Constructor

```ts
const builder = new TimeSeriesChartBuilder(echartsInstance, {
	externalManagerLegend: true // hides ECharts legends for external management
});
```

### Core methods

| Method | Description |
| --- | --- |
| `setDataset(data, dimensionNames?)` | Sets the dataset and auto-generates line series. Accepts arrays, object arrays, or simple objects. |
| `addDimension(data, dimName)` | Incrementally adds a new dimension/column to the existing dataset. |
| `toggleLegend(column)` | Toggles visibility of a series by legend name. |
| `goToZoom(start, end)` | Programmatically sets the data zoom range (0–100). |
| `build()` | Applies the current option to ECharts via `setOption()` with incremental merge. |

### Customization methods

| Method | Description |
| --- | --- |
| `setTitle(text, subtext?)` | Sets centered chart title and optional subtitle. |
| `setLegendIcon(icon)` | Sets legend icon shape (`'circle'`, `'rect'`, `'roundRect'`, `'triangle'`, `'diamond'`, `'pin'`, `'none'`). |
| `setDataZoom(options)` | Replaces data zoom configuration. |
| `setGrid(gridOption)` | Merges grid layout options. |
| `setSeriesStyle(style)` | Applies partial `LineSeriesOption` to all existing series. |
| `setAxisTooltip()` | Configures axis-based tooltip with crosshair. |

### Query methods

| Method | Returns |
| --- | --- |
| `getDimensionKeys()` | `{ x: string, y: string[] }` — dimension key names. |
| `getLegendStatus()` | `Record<string, boolean>` — current legend selection state. |
| `getTotalRows()` | `number` — total rows in the dataset. |
| `getRangeValues()` | `[number, number]` — first and last timestamp in the dataset. |

## Data formats

`setDataset()` accepts three data formats:

**Simple object** — column-oriented (recommended for Arrow/DuckDB output):

```ts
builder.setDataset({
	_ts: [1700000000000, 1700003600000],
	price: [100.5, 101.2],
	volume: [5000, 6200]
});
```

**Array of objects** — row-oriented:

```ts
builder.setDataset([
	{ _ts: 1700000000000, price: 100.5, volume: 5000 },
	{ _ts: 1700003600000, price: 101.2, volume: 6200 }
]);
```

**2D array** — requires explicit dimension names:

```ts
builder.setDataset(
	[
		[1700000000000, 100.5, 5000],
		[1700003600000, 101.2, 6200]
	],
	['_ts', 'price', 'volume']
);
```

The first column/key is always treated as the time dimension. Columns ending with `%` are automatically assigned to a secondary Y-axis.

## Markers and annotations

### Marker points

```ts
builder.addMarkerPoint(
	1,
	{ dimName: 'price', timestamp: 1700000000000, name: 'Entry' },
	{ icon: 'pin', color: '#FF7F50', symbolSize: 18 }
);
```

### Marker events (vertical lines)

```ts
builder.addMarkerEvents([
	{
		name: 'Breakout',
		xAxis: [1700000000000],
		icon: 'arrowUp',
		color: '#22c55e',
		position: 'aboveBar'
	}
]);
```

### Mark areas (highlighted regions)

```ts
builder.addMarkArea([
	{
		name: 'Session',
		xAxis: [1700000000000, 1700014400000],
		color: 'rgba(0, 17, 255, 0.1)'
	}
]);
```

## Development

```bash
# From the monorepo root
pnpm dev:charts

# Build
pnpm --filter @qtsurfer/sveltecharts build

# Type check
pnpm --filter @qtsurfer/sveltecharts check
```

## License

[Apache-2.0](../../LICENSE)
