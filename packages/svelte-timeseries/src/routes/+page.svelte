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
		<option value="{baseUrl}signals.parquet">Signals sample 1</option>
	</select>
</div>

<SvelteTimeSeries {url} />
