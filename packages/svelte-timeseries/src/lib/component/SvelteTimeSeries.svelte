<script lang="ts">
	import { onMount } from 'svelte';
	import { SVECharts } from '@qtsurfer/sveltecharts';
	import { DuckChart } from '$lib/DuckChart';

	export let url: string | undefined = undefined;
	export let debug: boolean = false;

	let chart: SVECharts;
	let duckChart: DuckChart;
	onMount(async () => {
		duckChart = new DuckChart();
		duckChart.debug = debug;
		await duckChart.initDB();
		loadUrl(url!);
	});
	const handleDataZoom = (e: CustomEvent) => {
		let start, end;
		if (e.detail.batch) {
			const [info] = e.detail.batch;
			start = info.start;
			end = info.end;
		} else {
			start = e.detail.start;
			end = e.detail.end;
		}
		duckChart.loadRange(start, end).then(() => {
			// Force Svelte reactivity
			// @ts-ignore
			duckChart.option.dataZoom[0] = { ...duckChart.option.dataZoom[0], start, end };
			duckChart.option.dataset = duckChart.option.dataset;
		});
	};

	const loadUrl = async (url: string) => {
		if (!url || url === '') return;
		if (!duckChart) return;
		await duckChart.load(url);
		duckChart.option = { ...duckChart.option }; // Force Svelte reactivity
	};
	$: if (url) {
		loadUrl(url);
	}
</script>

{#if duckChart?.option}
	<SVECharts bind:this={chart} option={duckChart?.option} on:datazoom={handleDataZoom} />
{/if}
