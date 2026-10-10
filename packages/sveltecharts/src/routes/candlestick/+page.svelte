<script lang="ts">
	import { TimeSeriesChartBuilder } from '$lib/TimeSeriesChartBuilder';
	import { LightweightTimeSeriesChartBuilder } from '$lib/LightweightTimeSeriesChartBuilder';
	import { VelaTimeSeriesChartBuilder } from '$lib/VelaTimeSeriesChartBuilder';
	import { createOHLCDataSet } from '$lib/mockDataSet';
	import type { ECharts } from 'echarts/core';
	import type { IChartApi } from 'lightweight-charts';
	import type { Vela } from '@luxalgo/vela';
	import SVECharts from '$lib/SVECharts.svelte';
	import SVELightweightCharts from '$lib/SVELightweightCharts.svelte';
	import SVEVelaCharts from '$lib/SVEVelaCharts.svelte';

	let loadingEcharts = $state(true);
	let loadingLightweight = $state(true);
	let loadingVela = $state(true);

	// ECharts' own default zoom window is a fixed 45%-55% slice of the dataset, regardless of
	// size (see TimeSeriesChartBuilder's dataZoom default) — every marker below sits inside that
	// slice (bars 18-22 of 40) so it's visible without fighting any engine's zoom API.
	const BARS = 40;
	const ohlcDims = { open: 'open', high: 'high', low: 'low', close: 'close' };

	function computeSma(data: ReturnType<typeof createOHLCDataSet>): (number | null)[] {
		const period = 5;
		return data.close.map((_, i, arr) => {
			if (i < period - 1) return null;
			const window = arr.slice(i - period + 1, i + 1);
			return window.reduce((sum, v) => sum + (v ?? 0), 0) / period;
		});
	}

	async function onLoadEcharts(instance: ECharts) {
		loadingEcharts = true;
		const data = createOHLCDataSet(BARS);
		const builder = new TimeSeriesChartBuilder(instance);
		builder.setTitle('Candlestick — ECharts').setCandlestickSeries(data, ohlcDims);
		// ECharts needs a frame after each setOption to finish its internal layout pass before
		// the next one — calling addDimension/addMarkerPoint/build back-to-back in the same tick
		// (as this demo would otherwise do) can silently drop the later updates. Production code
		// never hits this: TimeSeriesFacade's calls are naturally spaced out by DuckDB queries.
		await new Promise((r) => requestAnimationFrame(r));
		// Markers must target a dimension that's its own line series (added via addDimension) —
		// 'close' lives inside the candlestick series itself, not a standalone series with its
		// own `encode.y`, so addMarkerPoint can never find it (throws "Dimension not found",
		// caught and logged, marker silently dropped).
		builder.addDimension({ sma: computeSma(data) }, 'sma');
		await new Promise((r) => requestAnimationFrame(r));
		// Same Buy/Sell markers as the Vela chart below, for a same-page comparison.
		builder.addMarkerPoint(
			1,
			{ dimName: 'sma', timestamp: data._ts[19], name: 'Buy' },
			{ color: '#16a34a', icon: 'arrowUp', symbolSize: 28 }
		);
		builder.addMarkerPoint(
			2,
			{ dimName: 'sma', timestamp: data._ts[21], name: 'Sell' },
			{ color: '#dc2626', icon: 'arrowDown', symbolSize: 28 }
		);
		// addMarkerPoint only mutates internal state — build() is what actually calls
		// ECharts.setOption and flushes it to the chart.
		builder.build();
		// ECharts opens on the middle 10% of the data and applies a zoom only once it has drawn its
		// first frame, so ask for all of it on the next one.
		requestAnimationFrame(() => builder.goToZoom(0, 100));
		loadingEcharts = false;
	}

	async function onLoadLightweight(instance: IChartApi) {
		loadingLightweight = true;
		const data = createOHLCDataSet(BARS);
		const builder = new LightweightTimeSeriesChartBuilder(instance);
		builder.setCandlestickSeries(data, ohlcDims);
		// See the ECharts loader above for why markers target 'sma', not 'close'.
		builder.addDimension({ sma: computeSma(data) }, 'sma');
		// Same Buy/Sell markers as the Vela chart below, for a same-page comparison.
		builder.addMarkerPoint(
			1,
			{ dimName: 'sma', timestamp: data._ts[19], name: 'Buy' },
			{ color: '#16a34a', icon: 'arrowUp', symbolSize: 8 }
		);
		builder.addMarkerPoint(
			2,
			{ dimName: 'sma', timestamp: data._ts[21], name: 'Sell' },
			{ color: '#dc2626', icon: 'arrowDown', symbolSize: 8 }
		);
		// addMarkerPoint only mutates internal state — build() is what actually applies it.
		builder.build();
		loadingLightweight = false;
	}

	async function onLoadVela(instance: Vela) {
		loadingVela = true;
		const data = createOHLCDataSet(BARS);
		const builder = new VelaTimeSeriesChartBuilder(instance);
		builder.setCandlestickSeries(data, ohlcDims);
		// Vela's overlay native-indicator mount is asynchronous (it waits for the chart's own
		// readiness before its context is handed to this builder — see
		// VelaTimeSeriesChartBuilder's class-level doc comment), so addDimension/addMarkerPoint
		// calls made before that resolves just queue state. A frame is plenty in practice;
		// production code never has to think about this since TimeSeriesFacade's calls are
		// naturally spaced out by DuckDB queries anyway.
		await new Promise((r) => requestAnimationFrame(r));

		// Demonstrates the overlay channel: an extra line series computed from already-loaded
		// data (a simple moving average over `close`, no scripting engine involved) and a
		// couple of markers, both rendered on top of the candlestick. Unlike ECharts/Lightweight,
		// Vela's marker lookup reads directly from its own unified dataset, so `dimName: 'close'`
		// (never added as its own series) still resolves fine here.
		builder.addDimension({ sma: computeSma(data) }, 'sma');
		await new Promise((r) => requestAnimationFrame(r));

		// Of the four cross-engine-consistent icons (ChartMarkerPointOptions.icon's doc comment),
		// Vela now renders all four distinctly too: 'circle' uses its native circles kind,
		// 'square'/'arrowUp'/'arrowDown' are hand-built filled polylines (see
		// buildSquarePolyline/buildTrianglePolyline). symbolSize has no effect here — Vela's
		// hand-built shapes size themselves from the bar's own high-low range.
		builder.addMarkerPoint(
			1,
			{ dimName: 'close', timestamp: data._ts[19], name: 'Buy' },
			{ color: '#16a34a', icon: 'arrowUp', symbolSize: 28 }
		);
		builder.addMarkerPoint(
			2,
			{ dimName: 'close', timestamp: data._ts[21], name: 'Sell' },
			{ color: '#dc2626', icon: 'arrowDown', symbolSize: 28 }
		);

		// Same-bar collision demo: two markers sharing BOTH dimension and bar ('close' at bar
		// 20, blue + orange) would otherwise land on the identical (bar, value) and the later
		// one would render exactly on top of the first — they're now nudged apart so both are
		// visible. A third marker on a DIFFERENT dimension ('sma', purple) at the SAME bar
		// renders at its own value, naturally distinct — both cases used to overwrite silently.
		const collisionBar = data._ts[20];
		builder.addMarkerPoint(
			3,
			{ dimName: 'close', timestamp: collisionBar, name: 'Same bar + dim #1' },
			{ color: '#2563eb', icon: 'circle' }
		);
		builder.addMarkerPoint(
			4,
			{ dimName: 'close', timestamp: collisionBar, name: 'Same bar + dim #2' },
			{ color: '#f97316', icon: 'square' }
		);
		builder.addMarkerPoint(
			5,
			{ dimName: 'sma', timestamp: collisionBar, name: 'Same bar, different dim' },
			{ color: '#9333ea', icon: 'circle' }
		);

		loadingVela = false;
	}
</script>

<main>
	<h1>Candlestick demo</h1>

	<p class="note">
		All three charts show the same Buy (<code>arrowUp</code>)/Sell (<code>arrowDown</code>) markers
		plus an <code>sma</code> overlay line. The Vela chart additionally has 3 markers deliberately
		placed on the same bar near the right edge — blue (<code>circle</code>) and orange (<code
			>square</code
		>) share the <code>close</code> dimension (render as two separate, visually distinct shapes
		instead of one hiding the other), and purple (<code>circle</code>) is on <code>sma</code> at the same
		bar (its own value, naturally apart). Together with Buy/Sell, that's all four cross-engine-consistent
		icons (circle/square/arrowUp/arrowDown) rendering as genuinely distinct shapes on Vela too, not just
		a fallback circle.
	</p>

	<div class="charts-container">
		<div class="chart">
			<h2>ECharts</h2>
			<div class="chart-wrapper">
				<SVECharts onLoad={onLoadEcharts} loading={loadingEcharts} isDark={false} />
			</div>
		</div>

		<div class="chart">
			<h2>Lightweight Charts</h2>
			<div class="chart-wrapper">
				<SVELightweightCharts
					onLoad={onLoadLightweight}
					loading={loadingLightweight}
					isDark={false}
				/>
			</div>
		</div>

		<div class="chart">
			<h2>Vela</h2>
			<div class="chart-wrapper">
				<SVEVelaCharts onLoad={onLoadVela} loading={loadingVela} isDark={false} />
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

	.note {
		font-size: 0.875rem;
		color: #52525b;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
		padding: 0.5rem 1rem;
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
		height: 500px;
	}

	.chart-wrapper {
		flex: 1;
		width: 100%;
		position: relative;
		min-height: 0;
	}
</style>
