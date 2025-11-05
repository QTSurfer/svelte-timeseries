<script lang="ts">
	import { SVECharts, type EChartsOption } from '$lib';
	import { TimeSeriesChartBuilder } from '$lib';
	import { createDataSet } from '$lib/mockDataSet';
	import type { MarkArea, MarkerEvent } from '$lib/TimeSeriesChartBuilder';
	import { onMount } from 'svelte';

	let timeSeriesOption: EChartsOption = {};
	const timeSeries = new TimeSeriesChartBuilder(timeSeriesOption);
	let loading = $state(true);

	onMount(async () => {
		loading = true;
		const totalHours = 1000;
		const { data, yDimensionsNames } = createDataSet<number[]>(totalHours, 'array');
		const marker: MarkerEvent[] = [
			{
				name: 'Event 1',
				icon: 'circle',
				xAxis: [data[400][0], data[450][0]],
				color: '#ff0000'
			}
		];

		const area: MarkArea[] = [
			{
				name: 'Event with name',
				xAxis: [data[600][0], data[650][0]]
			},
			{
				xAxis: [data[800][0], data[820][0]]
			}
		];

		timeSeries
			.setTitle('Time Series Data ARRAY', 'hours')
			.setDataset(data, yDimensionsNames)
			.setLegendIcon('rect')
			.addMarkerEvents(marker)
			.addMarkArea(area)
			.addMarkerPoint({
				dimName: 'Column 1',
				timestamp: data[600][0],
				name: 'Point 1'
			});

		await new Promise((r) => setTimeout(r, 3000));

		loading = false;
	});
</script>

<main>
	<div class="charts-container">
		<div class="chart">
			<div class="chart-wrapper">
				<SVECharts option={timeSeriesOption} />
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
