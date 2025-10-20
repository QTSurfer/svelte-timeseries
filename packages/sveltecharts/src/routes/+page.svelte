<script lang="ts">
	import svelteLogo from '@assets/svelte.svg';
	import { SVECharts } from '$lib';
	import { TimeSeriesChartBuilder } from '$lib';

	// Time Series Data
	const getUTCDates = (hours = 24): number[] => {
		let dates: number[] = [];
		let now = Date.now();
		for (let i = 0; i < hours; i++) {
			dates.push(new Date(now + i * 3600000).getTime());
		}
		return dates;
	};
	const random = (min = 1, max = 100): number => Math.random() * max + min;

	const timeSeriesData = [];
	for (let time of getUTCDates()) {
		timeSeriesData.push([time, random(), random(), random(), random(), random()]);
	}

	const timeSeriesOption = new TimeSeriesChartBuilder()
		.setDataset(timeSeriesData)
		.setAxisTooltip()
		.setLegendIcon('circle')
		.setDataZoom()
		.setTitle('Time Series Data', 'Last 24 hours')
		.setSeriesStyle({ smooth: true, symbol: 'none' })
		.build();

	timeSeriesOption.grid = {
		top: 60,
		bottom: 80,
		left: 80,
		right: 30,
		containLabel: true
	};

	if (timeSeriesOption.dataZoom && Array.isArray(timeSeriesOption.dataZoom)) {
		timeSeriesOption.dataZoom[0] = {
			...timeSeriesOption.dataZoom[0],
			bottom: 30,
			height: 30,
			left: '5%',
			right: '5%'
		};
	}
</script>

<main>
	<div class="header">
		<a href="https://svelte.dev" target="_blank" title="Svelte"
			><img src={svelteLogo} class="logo svelte" alt="Svelte Logo" /></a
		>
		<h1>Svelte ECharts Demo</h1>
	</div>

	<div class="charts-container">
		<div class="chart">
			<h2>Time Series Chart</h2>
			<div class="chart-wrapper">
				<SVECharts option={timeSeriesOption} />
			</div>
		</div>
	</div>
</main>

<style>
	main {
		width: 95vw;
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}
	.logo {
		height: 4em;
		padding: 0.5em;
		will-change: filter;
		transition: filter 300ms;
	}
	.logo:hover {
		filter: drop-shadow(0 0 2em #646cffaa);
	}
	.logo.svelte:hover {
		filter: drop-shadow(0 0 2em #ff3e00aa);
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
		width: 100%;
	}
	.chart:hover {
		transform: translateY(-5px);
		box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
	}
	.chart h2 {
		margin: 0 0 0.5rem 0;
		padding: 0.5rem;
		text-align: center;
		color: #333;
		font-size: 1.5rem;
		position: relative;
		z-index: 2;
		background: white;
		flex-shrink: 0;
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
		.header {
			margin-bottom: 1rem;
		}
		.logo {
			height: 3em;
		}
		.chart {
			height: 500px;
			padding: 0.75rem;
		}
	}
</style>
