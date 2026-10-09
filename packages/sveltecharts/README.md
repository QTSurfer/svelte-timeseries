# @qtsurfer/sveltecharts

![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsveltecharts?label=version&style=flat-square)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsveltecharts?style=flat-square)](https://npmjs.com/package/@qtsurfer/sveltecharts)

Svelte 5 components and builders for time-series charts on [Apache ECharts](https://echarts.apache.org/), [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) and [Vela](https://luxalgo.com/vela) (candlesticks). All backends sit behind one `TimeSeriesChartAdapter` interface.

This package is the chart layer of [`@qtsurfer/svelte-timeseries`](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries). Use it directly when your data is already in memory and you do not need DuckDB.

## Installation

```bash
pnpm add @qtsurfer/sveltecharts echarts lightweight-charts @luxalgo/vela
```

`echarts`, `lightweight-charts`, `@luxalgo/vela` and `svelte` are peer dependencies. Vela is Apache-2.0 with an attribution requirement for the charts it draws (see its `NOTICE`).

## Price data from arrays

`TimeSeriesChart` is the entry point for arrays: a price line or candles, plus your own indicator lines and markers. The chart fills its parent, so give the parent a height.

- **Time unit:** every `times` array is **epoch milliseconds** (UTC), ascending (unsorted input is sorted).
- **Values:** `number[]`, `Float64Array` or arrays holding `null`. `null` and `NaN` leave a gap.
- **Updates:** pass new arrays (or a new `injectedSeries` array). Series are matched by name and updated in place: the chart is not recreated and the visible time range is kept. Treat arrays as immutable.

```svelte
<script lang="ts">
	import { TimeSeriesChart } from '@qtsurfer/sveltecharts';
	import type { InjectedMarker, InjectedSeries } from '@qtsurfer/sveltecharts';

	// 300 one-minute bars of a synthetic price.
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

<div style="height: 520px">
	<TimeSeriesChart
		chartLibrary="lightweight"
		price={{ name: 'BTC/USDT', times, values: close }}
		{injectedSeries}
		{injectedMarkers}
	/>
</div>
```

For candles, pass `candles={{ times, open, high, low, close }}` instead of `price`.

### `TimeSeriesChart` props

| Prop                     | Type                                        | Description                                                                              |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `chartLibrary?`          | `'echarts' \| 'lightweight' \| 'vela'`      | Chart backend. Default `'echarts'`. `'vela'` draws `candles` only (see below).           |
| `price?`                 | `PriceLineInput`                            | `{ name?, times, values }` or `{ name?, points: [time, value][] }`.                      |
| `candles?`               | `CandlesInput`                              | `{ times, open, high, low, close }`. Wins over `price`.                                  |
| `injectedSeries?`        | `InjectedSeries[]`                          | Named lines computed by your app.                                                        |
| `injectedMarkers?`       | `InjectedMarker[]`                          | Buy, sell and info events.                                                               |
| `paneHeights?`           | `Record<number, number>`                    | Relative pane heights by pane number. Default: the price pane `3`, every other pane `1`. |
| `externalManagerLegend?` | `boolean`                                   | ECharts only: hide the built-in legend. Default `false`.                                 |
| `isDark?`                | `boolean`                                   | Dark palette for the chart and its tooltip.                                              |
| `onChartReady?`          | `(adapter: TimeSeriesChartAdapter) => void` | Called once the chart exists and its data is drawn.                                      |

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

`pane: 0` is the price pane. Any other number puts the series in its own pane with its own price scale. Panes are ordered by number and gaps collapse, so `0, 3, 7` become three consecutive panes. The crosshair and the time axis are shared.

### Markers

- A `buy` is a green arrow up below the bar, a `sell` a red arrow down above it and `info` a neutral circle. With a `price` the arrow sits just under (buy) or over (sell) that price and the circle is centered on it.
- Markers attach to the price series (the candlesticks, or the first loaded line) unless `series` names an injected series. They hide with the series they belong to.
- Markers that share a UTC second and look alike (position, shape, color and price) are merged into **one glyph labeled `×N`**; every original text is listed in the tooltip. Markers of the same second that look different stay separate and are stacked on the bar. Nothing is dropped.
- Texts show on hover (not drawn on the chart, except the `×N` count): in the crosshair tooltip on Lightweight Charts, in a small overlay while the pointer is on the marker on ECharts.

### What each backend supports

| Capability                                 | Lightweight Charts                                  | ECharts                                           | Vela                                            |
| ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Injected lines (color, width, style, gaps) | Yes                                                 | Yes                                               | No                                              |
| Panes and `paneHeights`                    | Native panes; resizable by dragging the separators  | Stacked grids with a shared zoom and crosshair    | No                                              |
| Markers, including on candlesticks         | Yes                                                 | Yes (mark points)                                 | JSON column markers only (no `injectedMarkers`) |
| Same-second merge and stacking             | Yes                                                 | Yes                                               | Overlapping markers are offset                  |
| Marker hover text                          | In the crosshair tooltip, for the whole bar         | Overlay while the pointer is on the marker symbol | No                                              |
| Line width                                 | Integers from 1 to 4                                | Any positive number                               | -                                               |
| Times inside the same second               | Collapse to the first point (chart time is seconds) | Kept (millisecond axis)                           | -                                               |

Builders report this through an optional `capabilities` object on the adapter (`injectedSeries`, `panes`, `paneHeights`, `injectedMarkers`, `markerTooltip`); the Vela builder reports every flag as `false`. `setInjectedSeries`, `setInjectedMarkers` and `setPaneHeights` are optional members of `TimeSeriesChartAdapter`, so check before calling them on an adapter you did not create. `describeUnsupportedInput(adapter, engine, input)` returns one message per input an adapter cannot draw; the components use it to warn once.

### Vela

`chartLibrary="vela"` on `TimeSeriesChart` draws `candles` (Vela renders one OHLCV market). A `price` line is rejected with a message, and `injectedSeries`, `injectedMarkers` and `paneHeights` are ignored with a warning logged once each. `TimeSeriesChart` loads Vela on demand, so the other engines never download it.

## Building blocks

| Export                                               | What it is                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TimeSeriesChart`                                    | Arrays entry point described above.                                                                                    |
| `SVECharts`, `SVELightweightCharts`, `SVEVelaCharts` | Chart components: they create the chart and hand you the instance in `onLoad`.                                         |
| `TimeSeriesChartBuilder`                             | ECharts builder (`setDataset`, `setCandlestickSeries`, `addMarkerPoint`, `setInjectedSeries`, ...).                    |
| `LightweightTimeSeriesChartBuilder`                  | Lightweight Charts builder with the same `TimeSeriesChartAdapter` surface.                                             |
| `VelaTimeSeriesChartBuilder`                         | Vela builder: candles, extra lines and JSON column markers (`setCandlestickSeries`, `addDimension`, `addMarkerPoint`). |
| `resolvePriceData`, `applyPriceData`                 | The conversion from arrays to a dataset and its in-place update, for custom components.                                |

See the [main README](https://github.com/QTSurfer/svelte-timeseries#readme) for the complete reference, including the DuckDB-backed `SvelteTimeSeries` component.
