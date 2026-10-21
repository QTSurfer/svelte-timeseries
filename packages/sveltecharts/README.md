# @qtsurfer/sveltecharts

![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsveltecharts?label=version&style=flat-square)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsveltecharts?style=flat-square)](https://npmjs.com/package/@qtsurfer/sveltecharts)

Svelte 5 components and builders for time-series charts on [Apache ECharts](https://echarts.apache.org/), [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) and [Vela](https://luxalgo.com/vela) (candlesticks). All backends sit behind one `TimeSeriesChartAdapter` interface.

This package is the chart layer of [`@qtsurfer/svelte-timeseries`](https://www.npmjs.com/package/@qtsurfer/svelte-timeseries). Use it directly when your data is already in memory and you do not need DuckDB.

## Installation

```bash
pnpm add @qtsurfer/sveltecharts echarts lightweight-charts @luxalgo/vela
```

`echarts`, `lightweight-charts`, `@luxalgo/vela` and `svelte` are peer dependencies. ECharts must be 6.1.0 or newer: 6.0.x renders the `name` of a Lines series datum into its default tooltip without escaping it (an XSS issue fixed in 6.1.0). Vela is Apache-2.0 with an attribution requirement for the charts it draws (see its `NOTICE`).

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

### Candles from a price line

If you hold a price per instant (ticks, trades, a ticker's last price) rather than finished bars, give `candles` the line and a bar length:

```svelte
<TimeSeriesChart candles={{ times, values: lastPrice, interval: '1m' }} />
```

The aggregation is also exported as a pure function, which additionally sums a per-tick volume into each bar:

```ts
import { aggregateCandles } from '@qtsurfer/sveltecharts';

const bars = aggregateCandles({ times, values: lastPrice, volumes: tradeSizes }, '5s');
// { times, open, high, low, close, volume }: parallel arrays, ready for `candles`
```

- `interval` is milliseconds or a string such as `'250ms'`, `'1s'`, `'5s'`, `'1m'`, `'15m'`, `'4h'`, `'1d'`; anything else throws a `RangeError` (a component reports it in the console and stays empty).
- Each bar covers `[start, start + interval)` and is stamped with `start`: `open` is the first tick, `close` the last, `high` / `low` the extremes. Buckets without ticks are skipped (a quiet period is a gap, not flat bars) and one tick makes a bar with open = high = low = close.
- Buckets are whole multiples of the interval counted from the Unix epoch, so they are UTC and no time zone is involved. For lengths up to half a day that divide a day this is the grid DuckDB's `time_bucket` uses.
- Unsorted times are sorted first (equal times keep their input order); ticks whose time or price is not finite are skipped together with their volume.
- A ticker's `open`, `high` and `low` describe a rolling 24-hour window, not the bar: aggregate its last price as above instead of passing them as `candles`. `volumes` must be per tick, not a running total. The chart does not draw the volume.

### `TimeSeriesChart` props

| Prop                     | Type                                            | Description                                                                                                                    |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `chartLibrary?`          | `'echarts' \| 'lightweight' \| 'vela'`          | Chart backend. Default `'echarts'`. `'vela'` draws `candles` only (see below).                                                 |
| `price?`                 | `PriceLineInput`                                | `{ name?, times, values }` or `{ name?, points: [time, value][] }`.                                                            |
| `candles?`               | `CandlesInput \| TickCandlesInput`              | `{ times, open, high, low, close }`, or a price line to aggregate: `{ times, values, interval, volumes? }`. Wins over `price`. |
| `injectedSeries?`        | `InjectedSeries[]`                              | Named lines computed by your app.                                                                                              |
| `injectedMarkers?`       | `InjectedMarker[]`                              | Buy, sell and info events.                                                                                                     |
| `paneHeights?`           | `Record<number, number>`                        | Relative pane heights by pane number. Default: the price pane `3`, every other pane `1`.                                       |
| `collapseEmptyPanes?`    | `boolean`                                       | Shrink a pane whose series are all hidden (`visible: false`) to a sliver. Default `false`.                                     |
| `priceDecimals?`         | `number`                                        | Lightweight Charts: decimals of the price axis for the price line and the candles, 0 to 16. Default: what the data needs.      |
| `markerHoverTolerance?`  | `number`                                        | Lightweight Charts: how many pixels from a marker its text still shows. Default `4`; `0` = the bar under the cursor only.      |
| `lightweightOptions?`    | `DeepPartial<ChartOptions>`                     | Lightweight Charts: options of the chart itself, merged into the defaults (background, text color, grid...).                   |
| `resetView?`             | `unknown`                                       | Change it to show all the data again, for example when a new run replaces the arrays under the same series name.               |
| `onCrosshairMove?`       | `(event: CrosshairMoveEvent) => void`           | Lightweight Charts: crosshair moves with the bar time (ms), its price and the pixel point.                                     |
| `onVisibleRangeChange?`  | `(range: { from: number; to: number }) => void` | Lightweight Charts: visible range in epoch milliseconds, when it changes.                                                      |
| `onLegendChange?`        | `(items: LegendItem[]) => void`                 | Lightweight Charts: series with color and visibility, for a legend of your own.                                                |
| `externalManagerLegend?` | `boolean`                                       | ECharts only: hide the built-in legend. Default `false`.                                                                       |
| `isDark?`                | `boolean`                                       | Dark palette for the chart and its tooltip.                                                                                    |
| `onChartReady?`          | `(adapter: TimeSeriesChartAdapter) => void`     | Called once the chart exists and its data is drawn.                                                                            |

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
	lastValueVisible?: boolean; // Lightweight Charts: label and name tag on the price axis, default true
	priceLineVisible?: boolean; // Lightweight Charts: line at the last value, default true
};

type InjectedMarker = {
	time: number; // epoch milliseconds
	kind: 'buy' | 'sell' | 'info';
	price?: number; // exact level; without it the marker is anchored to the bar
	text?: string; // shown in the hover tooltip
	color?: string; // default per kind: buy green, sell red, info slate
	shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; // default per kind
	series?: string; // name of an injected series to attach to (default: the price series)
	size?: number; // size multiplier, default 1; markers of different sizes are never merged
};
```

### Panes

`pane: 0` is the price pane. Any other number puts the series in its own pane with its own price scale. Panes are ordered by number and gaps collapse, so `0, 3, 7` become three consecutive panes. The crosshair and the time axis are shared.

### Markers

- A `buy` is a green arrow up below the bar, a `sell` a red arrow down above it and `info` a neutral circle. With a `price` the arrow sits just under (buy) or over (sell) that price and the circle is centered on it.
- Markers attach to the price series (the candlesticks, or the first loaded line) unless `series` names an injected series. They hide with the series they belong to.
- Markers that share a UTC second and look alike (position, shape, color, size and price) are merged into **one glyph labeled `×N`**; every original text is listed in the tooltip. Markers of the same second that look different stay separate and are stacked on the bar. Nothing is dropped.
- Texts show on hover (not drawn on the chart, except the `×N` count): in the crosshair tooltip on Lightweight Charts, in a small overlay while the pointer is on the marker on ECharts.

### The view, the crosshair and a legend of your own

On Lightweight Charts the adapter reports where the cursor is and what is visible, and lets you move the view. Check the flags in `capabilities` (`crosshairEvents`, `visibleRangeEvents`, `viewport`, `legend`) before relying on them with another engine.

```svelte
<script lang="ts">
	import {
		TimeSeriesChart,
		type LegendItem,
		type TimeSeriesChartAdapter
	} from '@qtsurfer/sveltecharts';

	let adapter: TimeSeriesChartAdapter | undefined;
	let legend = $state<LegendItem[]>([]);
	let run = $state(0); // bump it when a new run replaces the arrays
</script>

<TimeSeriesChart
	chartLibrary="lightweight"
	{price}
	{injectedSeries}
	resetView={run}
	onChartReady={(a) => (adapter = a)}
	onCrosshairMove={({ time, price }) => console.log(time, price)}
	onVisibleRangeChange={({ from, to }) => console.log(from, to)}
	onLegendChange={(items) => (legend = items)}
/>

{#each legend as item (item.name)}
	<button onclick={() => adapter?.toggleLegend?.(item.name)} style:color={item.color}>
		{item.visible ? '●' : '○'}
		{item.name}
	</button>
{/each}
```

- `adapter.setVisibleRange(fromMs, toMs)` shows a time range and `adapter.fitContent()` shows all the data. A dataset that replaces the old one through `setDataset` also shows all of it; new arrays under the same series name keep the view unless `resetView` changes.
- Lightweight Charts accepts bars down to 0.001 pixel apart, so a long series (100k ticks over 14 hours) fits in full.
- `onLegendChange` is called when the chart is ready and again when a series is added, removed or toggled. `adapter.toggleLegend(name)` flips a series; so does `visible` on an injected series.

### Markers on a crowded chart

- `size` multiplies the glyph: `size: 2` draws it twice as large (default `1`). Markers of different sizes are not merged into one glyph.
- With many bars per pixel the bar under the cursor is a matter of luck, so the hover shows the marker nearest to the cursor when it is within `markerHoverTolerance` pixels (default 4).
- `lastValueVisible: false` and `priceLineVisible: false` on an injected series remove its label and name tag on the price axis and its line across the chart, so a dozen series do not cover the axis. Its tooltip row keeps the name.
- `collapseEmptyPanes` shrinks a pane whose series are all hidden, instead of leaving it empty.

### Price axis

By default the price axis shows the most decimals any value needs, so one value such as `48000.123456789` shows every price as `48000.000000000`. Pass `priceDecimals` (0 to 16) to fix them for the price line and the candles. Injected series keep their own decimals.

### Chart options and attribution

`lightweightOptions` is merged into the defaults one object level at a time, so `{ layout: { background: { color: '#111' } } }` changes the background and keeps the default text color. The TradingView attribution logo is always shown, whatever `layout.attributionLogo` says.

### What each backend supports

| Capability                                                                                               | Lightweight Charts                                  | ECharts                                           | Vela                                            |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Injected lines (color, width, style, gaps)                                                               | Yes                                                 | Yes                                               | No                                              |
| Panes and `paneHeights`                                                                                  | Native panes; resizable by dragging the separators  | Stacked grids with a shared zoom and crosshair    | No                                              |
| Markers, including on candlesticks                                                                       | Yes                                                 | Yes (mark points)                                 | JSON column markers only (no `injectedMarkers`) |
| Same-second merge and stacking                                                                           | Yes                                                 | Yes                                               | Overlapping markers are offset                  |
| Marker hover text                                                                                        | In the crosshair tooltip, for the whole bar         | Overlay while the pointer is on the marker symbol | No                                              |
| Line width                                                                                               | Integers from 1 to 4                                | Any positive number                               | -                                               |
| Times inside the same second                                                                             | Collapse to the first point (chart time is seconds) | Kept (millisecond axis)                           | -                                               |
| Crosshair and visible range events, `setVisibleRange`, `fitContent`                                      | Yes                                                 | No                                                | No                                              |
| Legend items for a legend of your own (`getLegendItems`, `onLegendChange`)                               | Yes                                                 | Draws its own legend                              | No                                              |
| Marker hover tolerance, `lastValueVisible` and `priceLineVisible`, `priceDecimals`, `lightweightOptions` | Yes                                                 | -                                                 | -                                               |
| `setCollapseEmptyPanes`                                                                                  | Yes                                                 | Yes                                               | No                                              |

Builders report this through an optional `capabilities` object on the adapter (`injectedSeries`, `panes`, `paneHeights`, `injectedMarkers`, `markerTooltip`, `crosshairEvents`, `visibleRangeEvents`, `viewport`, `legend`); the Vela builder reports every flag as `false`. `setInjectedSeries`, `setInjectedMarkers` and `setPaneHeights` are optional members of `TimeSeriesChartAdapter`, so check before calling them on an adapter you did not create. `describeUnsupportedInput(adapter, engine, input)` returns one message per input an adapter cannot draw; the components use it to warn once.

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
| `aggregateCandles`                                   | Pure aggregation of a price line into OHLC bars of a fixed length (see above).                                         |
| `resolvePriceData`, `applyPriceData`                 | The conversion from arrays to a dataset and its in-place update, for custom components.                                |

### Pure helpers without a chart

`@qtsurfer/sveltecharts/core` exports the functions that need no chart (`aggregateCandles`, `resolvePriceData`, `normalizeInjectedMarkers`, `groupMarkers`, `getPricePrecision`, `formatPreciseValue` and the types). It imports no Svelte file and no chart library, so it loads in plain Node, in a test runner without the Svelte plugin and in a worker.

```ts
import { aggregateCandles } from '@qtsurfer/sveltecharts/core';

const bars = aggregateCandles({ times, values }, '1m');
```

### Using the builders directly

- `addMarkerPoint(id, data, options?)` takes the marker symbol as `options.icon` (`'circle'`, `'arrowUp'`, `'arrowDown'`, `'square'` on Lightweight Charts, any ECharts symbol such as `'pin'` there); `shape` is accepted as an alias.
- `setDataset(data, names)` wants `names` to list every column of `data`, the time column first: `setDataset({ _ts, price }, ['_ts', 'price'])`.
- ECharts opens on the middle 10% of the data. `TimeSeriesChart` zooms out to all of it after the first frame; with `TimeSeriesChartBuilder` call `goToZoom(0, 100)` after the next frame (an earlier call is ignored, the chart has not drawn yet).
- Lightweight Charts never draws bars closer than 0.5 px, so a chart shows at most two points per pixel of its width; with more points the first view shows the most recent ones.

See the [main README](https://github.com/QTSurfer/svelte-timeseries#readme) for the complete reference, including the DuckDB-backed `SvelteTimeSeries` component.

## Performance

Measured with `scripts/measure-performance.mjs` of the repository (headless Chromium on a recent laptop): a price line of 100k points paints in about 0.15 s on Lightweight Charts and 0.06 s on ECharts, and replacing a series or appending points takes 0.06 to 0.16 s at that size (arrays are replaced; there is no append call). Keep a series under about 50k points when it updates every second or faster and under about 100k otherwise; aggregate into candles beyond that. Numbers for 10k to 250k points are in the [main README](https://github.com/QTSurfer/svelte-timeseries#performance).
