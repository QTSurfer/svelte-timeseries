<script lang="ts">
	import svelteLogo from '@assets/svelte.svg';
	import SVECharts from '$lib/SVECharts.svelte';
	import type { EChartsOption } from '$lib/types';

	const getUTCDates = (hours = 24): number[] => {
		let dates: number[] = [];
		let now = Date.now();
		for (let i = 0; i < hours; i++) {
			dates.push(new Date(now + i * 3600000).getTime());
		}
		return dates;
	};
	const random = (min = 1, max = 100): number => Math.random() * max + min;

	const data = [];
	for (let time of getUTCDates()) {
		data.push([time, random(), random(), random(), random(), random()]);
	}

	const option: EChartsOption = {
		legend: {
			icon: 'circle'
		},
		tooltip: {
			trigger: 'axis',
			axisPointer: {
				animation: true,
				type: 'cross',
				lineStyle: {
					color: '#b00',
					width: 1,
					opacity: 1
				}
			}
		},
		dataset: {
			source: data
		},
		xAxis: {
			type: 'time'
		},
		yAxis: {},
		dataZoom: [
			{
				type: 'slider',
				filterMode: 'empty',
				brushSelect: true,
				start: 0,
				end: 25
			},
			{
				type: 'inside'
			}
		],
		series: []
	};
	for (let i = 1; i < data[0].length; i++) {
		//@ts-ignore
		option.series.push({
			type: 'line',
			name: 'Value ' + i,
			smooth: true,
			encode: {
				y: i
			}
		});
	}
</script>

<main>
	<div class="header">
		<a href="https://svelte.dev" target="_blank" title="Svelte"
			><img src={svelteLogo} class="logo svelte" alt="Svelte Logo" /></a
		>
		<h1>Svelte ECharts demo</h1>
	</div>
	<SVECharts {option} />
</main>

<style>
	main {
		width: 90vw;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.logo {
		height: 6em;
		padding: 1.5em;
		will-change: filter;
		transition: filter 300ms;
	}
	.logo:hover {
		filter: drop-shadow(0 0 2em #646cffaa);
	}
	.logo.svelte:hover {
		filter: drop-shadow(0 0 2em #ff3e00aa);
	}
</style>
