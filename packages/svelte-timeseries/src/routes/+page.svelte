<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteTimeSeries } from '$lib';

	let url: string | undefined = undefined;
	let baseUrl: string | undefined = undefined;

	/** Handle <select> change to load the selected parquet */
	async function handleSelectParquet(e: Event) {
		const target = e.target as HTMLSelectElement;
		if (!target.value) return;
		url = target.value;
		console.log('Selected url:', url);
	}

	onMount(async () => {
		baseUrl = window.location.href;
	});
</script>

<div>
	<select on:change={handleSelectParquet}>
		<option disabled selected>Select signals file:</option>
		<option value="{baseUrl}signals.parquet">Sample 1: One week of BTC/USDT ticker prices+indicators - 10M timestamps -</option>
		<option value="{baseUrl}temps_gzip.parquet">Sample 2: Temperatures sample 2 (gzip) - 1M timestamps -</option>
	</select>
</div>

<SvelteTimeSeries {url} debug/>
