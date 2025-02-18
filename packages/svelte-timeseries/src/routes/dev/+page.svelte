<script lang="ts">
	import { onMount } from 'svelte';
	import { SVECharts } from '@qtsurfer/sveltecharts';
	import { DuckChart } from '$lib/DuckChart';

	let chart: SVECharts;
	let duckChart: DuckChart;
	let baseUrl: string | undefined = undefined;

	/** Handle <select> change to load the global data from the selected parquet */
	async function handleSelectParquet(e: Event) {
		const target = e.target as HTMLSelectElement;
		const url = target.value;
		if (!url) return;

		await duckChart.load(url);
		duckChart.option = { ...duckChart.option }; // Force Svelte reactivity
		console.log('option:', duckChart.option);
	}

	/** Fired when user changes the dataZoom on the chart */
	function handleDataZoom(e: CustomEvent) {
		//console.log('DataZoom detail:', e.detail);
		let start, end;
		if (e.detail.batch) {
			const [info] = e.detail.batch;
			start = info.start;
			end = info.end;
		} else {
			start = e.detail.start;
			end = e.detail.end;
		}
		console.log('DataZoom detail:', start, end);
		duckChart.loadRange(start, end).then(() => {
			// Force Svelte reactivity
			// @ts-ignore
			duckChart.option.dataZoom[0] = { ...duckChart.option.dataZoom[0], start, end };
			duckChart.option.dataset = duckChart.option.dataset;
		});
	}

	onMount(async () => {
		baseUrl = window.location.href;
		duckChart = new DuckChart();
		await duckChart.initDB();
	});
</script>

<div>
	<select on:change={handleSelectParquet}>
		<option disabled selected>Select signals file:</option>
		<option value="{baseUrl}signals.parquet">Signals sample 1</option>
	</select>
</div>

{#if duckChart?.option}
	<SVECharts bind:this={chart} option={duckChart?.option} on:datazoom={handleDataZoom} />
{/if}
