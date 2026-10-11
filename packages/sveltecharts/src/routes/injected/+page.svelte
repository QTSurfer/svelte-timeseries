<script lang="ts">
	import DemoNav from '../DemoNav.svelte';
	import { TimeSeriesChart } from '$lib';
	import type {
		CandleInterval,
		CandlesSource,
		CrosshairMoveEvent,
		InjectedMarker,
		InjectedSeries,
		LegendItem,
		LightweightChartOptions,
		LightweightDeepPartial,
		PriceLineInput,
		TimeRangeMs,
		TimeSeriesChartAdapter
	} from '$lib';
	import { createDemoData, createTicks, ema as computeEma } from './demoData';

	type Mode = 'line' | 'candles' | 'ticks';
	const MODES: Mode[] = ['line', 'candles', 'ticks'];

	// Bars are generated up front; "Append bars" reveals more of them, so the arrays handed to the
	// chart are replaced (never mutated) and the chart updates in place.
	// "New run" replaces the data under the same series names: with `resetView` the chart shows all
	// of it again instead of keeping the old view.
	let run = $state(0);
	const demo = $derived(createDemoData(900, 60_000, 7 + run));
	let visibleBars = $state(600);
	// An hour of one-second ticks, aggregated into bars of the chosen length.
	const ticks = createTicks();
	let interval = $state<CandleInterval>('1m');
	let mode = $state<Mode>('line');
	let showEma = $state(true);
	let showRsi = $state(true);
	let showSma = $state(false);
	let emaDashed = $state(false);
	let showMarkers = $state(true);

	// Options of the chart itself (see the "Options" row of the toolbar).
	let markerSize = $state(1);
	let hoverTolerance = $state(4);
	let axisLabels = $state(true);
	let hideRsi = $state(false);
	let collapseEmptyPanes = $state(false);
	let decimals = $state('auto');
	let background = $state<'default' | 'dark' | 'sepia'>('default');

	const priceDecimals = $derived(decimals === 'auto' ? undefined : Number(decimals));
	const BACKGROUNDS: Record<string, LightweightDeepPartial<LightweightChartOptions> | undefined> = {
		default: undefined,
		dark: {
			layout: { background: { color: '#0b1020' }, textColor: '#e2e8f0' },
			grid: {
				vertLines: { color: 'rgba(148, 163, 184, 0.12)' },
				horzLines: { color: 'rgba(148, 163, 184, 0.12)' }
			}
		} as LightweightDeepPartial<LightweightChartOptions>,
		sepia: {
			layout: { background: { color: '#f5ecd9' }, textColor: '#3b2f1e' }
		} as LightweightDeepPartial<LightweightChartOptions>
	};
	const lightweightOptions = $derived(BACKGROUNDS[background]);

	// What the Lightweight chart reports: crosshair, visible range and the series for a legend.
	let crosshair = $state('');
	let visibleRange = $state('');
	let legend = $state<LegendItem[]>([]);
	const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);
	function onCrosshairMove(event: CrosshairMoveEvent) {
		crosshair =
			event.time === undefined
				? ''
				: `${clock(event.time)}  ${event.price === undefined ? '-' : event.price.toFixed(3)}`;
	}
	function onVisibleRangeChange(range: TimeRangeMs) {
		visibleRange = `${clock(range.from)} - ${clock(range.to)}`;
	}

	// Charts created, per backend: it must stay at 1 however the inputs change.
	let created = $state({ lightweight: 0, echarts: 0 });

	const slice = <T extends ArrayLike<number | null>>(values: T) =>
		(values as unknown as { slice(start: number, end: number): T }).slice(0, visibleBars);

	const times = $derived(slice(demo.times));
	const close = $derived(slice(demo.close));

	const price = $derived<PriceLineInput | undefined>(
		mode === 'line' ? { name: 'Price', times, values: close } : undefined
	);
	const candles = $derived<CandlesSource | undefined>(
		mode === 'candles'
			? {
					times,
					open: slice(demo.open),
					high: slice(demo.high),
					low: slice(demo.low),
					close
				}
			: mode === 'ticks'
				? { times: ticks.times, values: ticks.values, interval }
				: undefined
	);

	const series = $derived.by<InjectedSeries[]>(() => {
		const list: InjectedSeries[] = [];
		// The indicators and markers below are computed on the minute bars, not on the ticks.
		if (mode === 'ticks') return list;
		if (showEma) {
			list.push({
				name: 'EMA 20',
				times,
				values: slice(demo.ema),
				color: '#f59e0b',
				lineWidth: 2,
				lineStyle: emaDashed ? 'dashed' : 'solid',
				lastValueVisible: axisLabels,
				priceLineVisible: axisLabels
			});
		}
		if (showSma) {
			list.push({
				name: 'EMA 60',
				times,
				values: computeEma(close, 60),
				color: '#8b5cf6',
				lineStyle: 'dotted',
				lastValueVisible: axisLabels,
				priceLineVisible: axisLabels
			});
		}
		if (showRsi) {
			list.push({
				name: 'RSI 14',
				times,
				values: slice(demo.rsi),
				color: '#06b6d4',
				pane: 1,
				visible: !hideRsi,
				lastValueVisible: axisLabels,
				priceLineVisible: axisLabels
			});
		}
		return list;
	});

	const markers = $derived<InjectedMarker[]>(
		showMarkers && mode !== 'ticks'
			? demo.markers
					.filter((marker) => marker.time <= times[times.length - 1])
					.map((marker) => ({ ...marker, size: markerSize }))
			: []
	);

	const adapters: Partial<Record<'lightweight' | 'echarts', TimeSeriesChartAdapter>> = {};
	function lastQuarter() {
		const [first, last] = adapters.lightweight?.getRangeValues() ?? [0, 0];
		adapters.lightweight?.setVisibleRange?.(first + (last - first) * 0.75, last);
	}

	function ready(kind: 'lightweight' | 'echarts', adapter: TimeSeriesChartAdapter) {
		adapters[kind] = adapter;
		created[kind] += 1;
		// Handles for end-to-end checks and for poking at the adapters from the console.
		(window as unknown as { __demo: typeof adapters }).__demo = adapters;
	}
</script>

<main>
	<DemoNav current="/injected" />
	<h1>Price data from arrays, injected series and markers</h1>
	<div class="toolbar">
		<button
			data-testid="mode"
			onclick={() => (mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length])}
		>
			Mode: {mode}
		</button>
		{#if mode === 'ticks'}
			<label>
				Bar length
				<select data-testid="interval" bind:value={interval}>
					<option value="1s">1s</option>
					<option value="5s">5s</option>
					<option value="15s">15s</option>
					<option value="1m">1m</option>
					<option value="5m">5m</option>
				</select>
			</label>
		{:else}
			<button data-testid="append" onclick={() => (visibleBars = Math.min(900, visibleBars + 100))}>
				Append 100 bars ({visibleBars})
			</button>
		{/if}
		<button data-testid="toggle-ema" onclick={() => (showEma = !showEma)}>EMA 20</button>
		<button data-testid="toggle-dashed" onclick={() => (emaDashed = !emaDashed)}>
			EMA dashed
		</button>
		<button data-testid="toggle-sma" onclick={() => (showSma = !showSma)}>EMA 60</button>
		<button data-testid="toggle-rsi" onclick={() => (showRsi = !showRsi)}>RSI pane</button>
		<button data-testid="toggle-markers" onclick={() => (showMarkers = !showMarkers)}>
			Markers
		</button>
		<span data-testid="created">
			charts created: lightweight {created.lightweight}, echarts {created.echarts}
		</span>
	</div>

	<div class="toolbar" data-testid="options">
		<strong>Options</strong>
		<label>
			Marker size
			<select data-testid="marker-size" bind:value={markerSize}>
				<option value={1}>1 (default)</option>
				<option value={2}>2</option>
				<option value={3}>3</option>
			</select>
		</label>
		<label>
			Hover tolerance (Lightweight)
			<select data-testid="hover-tolerance" bind:value={hoverTolerance}>
				<option value={0}>0 px</option>
				<option value={4}>4 px (default)</option>
				<option value={12}>12 px</option>
				<option value={24}>24 px</option>
			</select>
		</label>
		<label>
			Price decimals (Lightweight)
			<select data-testid="decimals" bind:value={decimals}>
				<option value="auto">Auto</option>
				<option value="0">0</option>
				<option value="2">2</option>
				<option value="4">4</option>
				<option value="8">8</option>
			</select>
		</label>
		<label>
			Background (Lightweight)
			<select data-testid="background" bind:value={background}>
				<option value="default">Default</option>
				<option value="dark">Dark</option>
				<option value="sepia">Sepia</option>
			</select>
		</label>
		<label>
			<input data-testid="axis-labels" type="checkbox" bind:checked={axisLabels} />
			Last value on the axis (Lightweight)
		</label>
		<label>
			<input data-testid="hide-rsi" type="checkbox" bind:checked={hideRsi} />
			Hide RSI (keep its pane)
		</label>
		<label>
			<input data-testid="collapse-panes" type="checkbox" bind:checked={collapseEmptyPanes} />
			Collapse empty panes
		</label>
	</div>

	<div class="toolbar" data-testid="view">
		<strong>View</strong>
		<button data-testid="fit" onclick={() => adapters.lightweight?.fitContent?.()}>Fit all</button>
		<button data-testid="last-quarter" onclick={lastQuarter}>Last quarter</button>
		<button data-testid="new-run" onclick={() => (run += 1)}>New run (reset view)</button>
		<span class="readout" data-testid="crosshair">crosshair: {crosshair || '-'}</span>
		<span class="readout" data-testid="visible-range">visible: {visibleRange || '-'}</span>
	</div>

	<div class="charts-container">
		<div class="chart" data-testid="chart-lightweight">
			<h2>Lightweight Charts</h2>
			<div class="legend" data-testid="legend">
				{#each legend as item (item.name)}
					<button
						class:off={!item.visible}
						onclick={() => adapters.lightweight?.toggleLegend(item.name)}
					>
						<span class="dot" style:background={item.color}></span>
						{item.name}
					</button>
				{/each}
			</div>
			<div class="chart-wrapper">
				<TimeSeriesChart
					chartLibrary="lightweight"
					{price}
					{candles}
					injectedSeries={series}
					injectedMarkers={markers}
					markerHoverTolerance={hoverTolerance}
					{priceDecimals}
					{lightweightOptions}
					{collapseEmptyPanes}
					resetView={run}
					{onCrosshairMove}
					{onVisibleRangeChange}
					onLegendChange={(items) => (legend = items)}
					onChartReady={(adapter) => ready('lightweight', adapter)}
				/>
			</div>
		</div>

		<div class="chart" data-testid="chart-echarts">
			<h2>ECharts</h2>
			<div class="chart-wrapper">
				<TimeSeriesChart
					chartLibrary="echarts"
					{price}
					{candles}
					injectedSeries={series}
					injectedMarkers={markers}
					{collapseEmptyPanes}
					resetView={run}
					onChartReady={(adapter) => ready('echarts', adapter)}
				/>
			</div>
		</div>
	</div>
</main>

<style>
	main {
		margin: 0 auto;
		padding: 1rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: bold;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
		padding: 0.5rem 1rem;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1rem;
	}

	.toolbar button,
	.toolbar select {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0.25rem 0.75rem;
		background: white;
	}

	.readout {
		font-variant-numeric: tabular-nums;
		color: #475569;
		font-size: 0.875rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0 1rem 0.5rem;
		min-height: 1.5rem;
	}

	.legend button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 0.125rem 0.625rem;
		font-size: 0.8125rem;
		background: white;
	}

	.legend button.off {
		opacity: 0.45;
		text-decoration: line-through;
	}

	.dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		display: inline-block;
	}

	.charts-container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.chart {
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 560px;
	}

	.chart-wrapper {
		flex: 1;
		width: 100%;
		position: relative;
		min-height: 0;
	}
</style>
