<script lang="ts">
	import { SVECharts, type EChartsOption } from '$lib';
	import { TimeSeriesChartBuilder } from '$lib';
	import type { MarkArea, MarkerEvent } from '$lib/TimeSeriesChartBuilder';
	import { onMount } from 'svelte';

	const createDataSet = (hours: number): Record<string, number>[] => {
		// Create random number between min and max
		const random = (min = 45, max = 50): number => Math.random() * max + min;

		const timeSeriesData = [];

		// Create a date range
		let startDate = new Date(2025, 9, 28, 14, 0, 0).getTime();

		// Create random data per hour
		for (let i = 0; i < hours; i++) {
			// Add 1 hour
			const time = new Date(startDate + i * 3600000).getTime();
			timeSeriesData.push({
				_ts: time,
				col1: random(),
				col2: random(),
				col3: random(),
				col4: random(),
				'col5%': random(0, 5)
			});
		}

		return timeSeriesData;
	};

	const timeSeries = new TimeSeriesChartBuilder();

	let timeSeriesOption: EChartsOption = {};

	onMount(() => {
		const totalDays = 60;
		let dataCount = 1;

		const object = createDataSet(dataCount * totalDays);
		const yDimensions = ['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5 %'];

		const marker: MarkerEvent[] = [
			{
				name: 'Event 1',
				icon: 'circle',
				xAxis: [
					new Date(2025, 9, 28, 16, 0, 0).getTime(),
					new Date(2025, 9, 28, 19, 0, 0).getTime()
				],
				color: '#ff0000'
			}
		];

		const area: MarkArea[] = [
			{
				name: 'Event with name',
				xAxis: [
					new Date(2025, 9, 29, 16, 0, 0).getTime(),
					new Date(2025, 9, 29, 19, 0, 0).getTime()
				]
			},
			{
				xAxis: [
					new Date(2025, 9, 30, 15, 0, 0).getTime(),
					new Date(2025, 9, 30, 19, 0, 0).getTime()
				]
			}
		];
		timeSeries
			.setTitle('Time Series Data OBJECT', 'Last 24 hours')
			.setDataset(object, yDimensions, 'TIME')
			.setAxisTooltip()
			.setLegendIcon('rect')
			.setGrid({})
			.setSeriesStyle({ smooth: false, symbol: 'none' })
			.addMarkerEvents(marker)
			.addMarkArea(area)
			.addMarkerPoint({
				dimName: 'col1',
				timestamp: object[10]._ts
			})
			.addMarkerPoint({
				dimName: 'col5%',
				timestamp: object[25]._ts
			});

		timeSeriesOption = timeSeries.build();
	});
</script>

<main>
	<div class="charts-container">
		<div class="chart">
			{#if timeSeriesOption.series}
				<div class="chart-wrapper">
					<SVECharts option={timeSeriesOption} />
				</div>
			{/if}
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
