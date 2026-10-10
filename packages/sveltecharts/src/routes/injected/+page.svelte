<script lang="ts">
	import { TimeSeriesChart } from '$lib';
	import type {
		CandleInterval,
		CandlesSource,
		InjectedMarker,
		InjectedSeries,
		PriceLineInput,
		TimeSeriesChartAdapter
	} from '$lib';
	import { createDemoData, createTicks, ema as computeEma } from './demoData';

	type Mode = 'line' | 'candles' | 'ticks';
	const MODES: Mode[] = ['line', 'candles', 'ticks'];

	// Bars are generated up front; "Append bars" reveals more of them, so the arrays handed to the
	// chart are replaced (never mutated) and the chart updates in place.
	const demo = createDemoData(900);
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
				lineStyle: emaDashed ? 'dashed' : 'solid'
			});
		}
		if (showSma) {
			list.push({
				name: 'EMA 60',
				times,
				values: computeEma(close, 60),
				color: '#8b5cf6',
				lineStyle: 'dotted'
			});
		}
		if (showRsi) {
			list.push({ name: 'RSI 14', times, values: slice(demo.rsi), color: '#06b6d4', pane: 1 });
		}
		return list;
	});

	const markers = $derived<InjectedMarker[]>(
		showMarkers && mode !== 'ticks'
			? demo.markers.filter((marker) => marker.time <= times[times.length - 1])
			: []
	);

	const adapters: Partial<Record<'lightweight' | 'echarts', TimeSeriesChartAdapter>> = {};
	function ready(kind: 'lightweight' | 'echarts', adapter: TimeSeriesChartAdapter) {
		adapters[kind] = adapter;
		created[kind] += 1;
		// Handles for end-to-end checks and for poking at the adapters from the console.
		(window as unknown as { __demo: typeof adapters }).__demo = adapters;
	}
</script>

<main>
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

	<div class="charts-container">
		<div class="chart" data-testid="chart-lightweight">
			<h2>Lightweight Charts</h2>
			<div class="chart-wrapper">
				<TimeSeriesChart
					chartLibrary="lightweight"
					{price}
					{candles}
					injectedSeries={series}
					injectedMarkers={markers}
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

	.toolbar button {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0.25rem 0.75rem;
		background: white;
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
