<script lang="ts">
	import { TimeSeriesChartBuilder } from '$lib/TimeSeriesChartBuilder';
	import { LightweightTimeSeriesChartBuilder } from '$lib/LightweightTimeSeriesChartBuilder';
	import { createOHLCDataSet } from '$lib/mockDataSet';
	import type { ECharts } from 'echarts/core';
	import type { IChartApi } from 'lightweight-charts';
	import SVECharts from '$lib/SVECharts.svelte';
	import SVELightweightCharts from '$lib/SVELightweightCharts.svelte';

	let loadingEcharts = $state(true);
	let loadingLightweight = $state(true);

	const BARS = 500;
	const ohlcDims = { open: 'open', high: 'high', low: 'low', close: 'close' };

	async function onLoadEcharts(instance: ECharts) {
		loadingEcharts = true;
		const data = createOHLCDataSet(BARS);
		const builder = new TimeSeriesChartBuilder(instance);
		builder.setTitle('Candlestick — ECharts').setCandlestickSeries(data, ohlcDims);
		loadingEcharts = false;
	}

	async function onLoadLightweight(instance: IChartApi) {
		loadingLightweight = true;
		const data = createOHLCDataSet(BARS);
		const builder = new LightweightTimeSeriesChartBuilder(instance);
		builder.setCandlestickSeries(data, ohlcDims);
		loadingLightweight = false;
	}
</script>

<main>
	<h1>Candlestick demo</h1>

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
