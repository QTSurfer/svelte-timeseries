<script lang="ts">
	import { SVECharts, type EChartsOption } from '$lib';
	import { TimeSeriesChartBuilder } from '$lib';
	import { createDataSet } from '$lib/mockDataSet';
	import type { MarkArea, MarkerEvent } from '$lib/TimeSeriesChartBuilder';
	import { onMount } from 'svelte';

	let timeSeriesOption: EChartsOption = {};
	const timeSeries = new TimeSeriesChartBuilder(timeSeriesOption);
	let loading = $state(true);
	let changes = $state(0);

	onMount(async () => {
		const totalHours = 700000;

		const { data: object, yDimensionsNames } = createDataSet<Record<string, any>>(
			totalHours,
			'object'
		);

		await new Promise((r) => setTimeout(r, 3000));

		const marker: MarkerEvent[] = [
			{
				name: 'Event 1',
				icon: 'arrowUp',
				xAxis: [object[100]._ts, object[150]._ts],
				color: 'green',
				position: 'belowBar'
			},
			{
				name: 'Event 2',
				icon: 'arrowUp',
				xAxis: [object[125]._ts],
				color: 'black',
				position: 'aboveBar'
			}
		];

		const area: MarkArea[] = [
			{
				name: 'Event with name',
				xAxis: [object[300]._ts, object[320]._ts]
			},
			{
				xAxis: [object[350]._ts, object[380]._ts]
			}
		];
		timeSeries
			.setTitle('Time Series Data OBJECT', 'Last 24 hours')
			.setDataset(object, yDimensionsNames, 'TIME')
			.setLegendIcon('rect')
			.setSeriesStyle({ smooth: false, symbol: 'none' })
			.addMarkerEvents(marker)
			.addMarkArea(area);

		timeSeries
			.addMarkerPoint(
				{
					dimName: 'col1',
					timestamp: object[600]._ts,
					name: 'Point 1'
				},
				{
					icon: 'arrowUp',
					color: 'red'
				}
			)
			.addMarkerPoint(
				{
					dimName: 'col1',
					timestamp: object[700]._ts,
					name: 'Point 2'
				},
				{
					icon: 'arrowDown',
					color: 'green'
				}
			)
			.addMarkerPoint(
				{
					dimName: 'col1',
					timestamp: object[750]._ts,
					name: 'Point 3'
				},
				{
					icon: 'circle',
					color: 'green'
				}
			);

		changes++;
		loading = false;
	});
</script>

<main>
	<div class="charts-container">
		<div class="chart">
			<div class="chart-wrapper">
				<SVECharts option={timeSeriesOption} {loading} {changes} />
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
