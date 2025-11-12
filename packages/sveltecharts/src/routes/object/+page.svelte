<script lang="ts">
	import { SVECharts, type ECharts } from '$lib';
	import { TimeSeriesChartBuilder } from '$lib/TimeSeriesChartBuilder';
	import { createDataSet } from '$lib/mockDataSet';
	import type { MarkArea, MarkerEvent } from '$lib/TimeSeriesChartBuilder';

	let loading = $state(true);

	async function onLoad(instance: ECharts) {
		loading = true;
		const totalHours = 700000;

		const { data, yDimensionsNames } = createDataSet<Record<string, any>>(totalHours, 'object');

		const timeSeries = new TimeSeriesChartBuilder(instance);
		const timeKey = yDimensionsNames[0];
		const marker: MarkerEvent[] = [
			{
				name: 'Event 1',
				icon: 'circle',
				xAxis: [data[320000][timeKey], data[350000][timeKey]],
				color: '#ff0000'
			}
		];

		const area: MarkArea[] = [
			{
				name: 'Event with name',
				xAxis: [data[330000][timeKey], data[340000][timeKey]]
			},
			{
				xAxis: [data[360000][timeKey], data[380000][timeKey]]
			}
		];

		timeSeries
			.setTitle('Time Series Data OBJECT', 'hours')
			.setDataset(data, yDimensionsNames)
			.addMarkArea(area)
			.addMarkerEvents(marker);

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
