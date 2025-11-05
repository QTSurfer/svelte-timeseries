<script lang="ts">
	import { onMount } from 'svelte';
	import { SVECharts } from '@qtsurfer/sveltecharts';
	import { DuckChart } from '$lib/DuckChart';

	export let url: string;
	export let debug: boolean = false;

	let chart: SVECharts;
	let duckChart: DuckChart;

	let loading = false;
	let changes = 0;

	onMount(async () => {
		console.log('Mounting SvelteTimeSeries...');
		duckChart = new DuckChart();
		duckChart.debug = debug;
		loadUrl(url);
	});

	/**
	 * @todo Fix this
	 */
	// const handleDataZoom = (e: CustomEvent) => {
	// let start, end;
	// if (e.detail.batch) {
	// 	const [info] = e.detail.batch;
	// 	start = info.start;
	// 	end = info.end;
	// } else {
	// 	start = e.detail.start;
	// 	end = e.detail.end;
	// }
	// duckChart.loadRange(start, end).then(() => {
	// 	// Force Svelte reactivity
	// 	// @ts-ignore
	// 	duckChart.option.dataZoom[0] = { ...duckChart.option.dataZoom[0], start, end };
	// 	duckChart.option.dataset = duckChart.option.dataset;
	// });
	// };

	const loadUrl = async (url: string) => {
		if (!url || url === '') return;
		if (!duckChart) return;
		loading = true;
		await duckChart.initDB(url);
		await duckChart.load(url);
		duckChart.option = { ...duckChart.option }; // Force Svelte reactivity
		changes++;
		loading = false;
	};
	$: if (url) {
		loadUrl(url);
	}
</script>

{#if duckChart?.option}
	<SVECharts bind:this={chart} option={duckChart?.option} {loading} {changes} />
{/if}
