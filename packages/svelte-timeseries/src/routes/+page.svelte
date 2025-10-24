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
		setTimeout(() => {
			const select = document.querySelector('select') as HTMLSelectElement;
			if (select && select.options.length > 1) {
				select.selectedIndex = 0;
				url = select.value;
			}
		}, 1000);
	});
</script>

<div class="container">
	<h1>SvelteTimeSeries demo</h1>
	<div>
		<select on:change={handleSelectParquet}>
			<option value="{baseUrl}signals.parquet"
				>Sample 1: One week of BTC/USDT ticker prices+indicators - 10M timestamps -</option
			>
			<option value="{baseUrl}temps_gzip.parquet"
				>Sample 2: Temperatures sample (gzip) - 1M timestamps -</option
			>
			<option value="{baseUrl}temps_gzip_mini.parquet"
				>Sample 3: Temperatures sample 2 (gzip) - 100 timestamps -</option
			>
		</select>
	</div>

	{#if url}
		<SvelteTimeSeries {url} debug />
	{/if}
</div>

<style>
	.container {
		margin: 0 auto;
		padding: 20px;
		height: 80vh;
		box-sizing: border-box;
	}
	h1 {
		text-align: center;
		font-size: 2rem;
		margin-bottom: 20px;
	}
	select {
		width: 100%;
		padding: 10px;
		font-size: 1rem;
		margin-bottom: 20px;
		border: 1px solid #ccc;
		border-radius: 4px;
		background-color: #f9f9f9;
	}
</style>
