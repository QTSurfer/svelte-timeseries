<script lang="ts">
	import { TimeSeriesChartBuilder } from '$lib/TimeSeriesChartBuilder';
	import type { ECharts } from 'echarts/core';
	import SVECharts from '$lib/SVECharts.svelte';

	let loading = $state(true);

	async function onLoad(instance: ECharts) {
		loading = true;
		const totalData = 1000000;
		const data = {
			ts: new Array(totalData).fill(0).map((_, i) => 1763040933000 + i * 1000),
			price: new Array(totalData).fill(0).map((_, i) => i * 10)
		};

		const data2 = {
			count: new Array(totalData).fill(0).map((_, i) => i * 11.1)
		};

		const timeSeries = new TimeSeriesChartBuilder(instance);

		timeSeries.setTitle('Time Series Data', 'hours');
		timeSeries.setDataset(data).build();
		loading = false;

		await new Promise((resolve) => setTimeout(resolve, 5000));
		timeSeries.addDimension(data2, 'count');
		loading = false;
	}
</script>

<main>
	<div class="charts-container">
		<div class="chart">
			<div class="chart-wrapper">
				<SVECharts {onLoad} {loading} />
			</div>
		</div>
	</div>
</main>

<style>
	main {
		margin: 0 auto;
		padding: 1rem;
	}

	.charts-container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		align-items: stretch;
	}
	.chart {
		background: white;
		padding: 1rem;
		border-radius: 12px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 600px;
	}

	.chart-wrapper {
		flex: 1;
		width: 100%;
		position: relative;
		overflow: visible;
		margin: 0;
		padding: 0;
		min-height: 0;
	}
	@media (max-width: 768px) {
		main {
			width: 100vw;
			padding: 0.5rem;
		}
		.chart {
			height: 500px;
			padding: 0.75rem;
		}
	}
</style>
