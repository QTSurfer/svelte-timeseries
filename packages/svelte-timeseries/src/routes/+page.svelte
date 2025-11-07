<script lang="ts">
	import { SvelteTimeSeries } from '$lib';
	import { type Tables } from '$lib/duckdb/DuckDB';
	import { onMount } from 'svelte';

	let selected = $state<number | null>(null);
	let baseUrl = $state();

	let tables = $derived<
		{
			name: string;
			tables: Tables;
		}[]
	>([
		{
			name: 'Sample 1: One week of BTC/USDT ticker prices+indicators - 10M timestamps -',
			tables: {
				markers: {
					table: 'signal',
					targetColumn: '_m'
				},
				signal: `${baseUrl}/signals.parquet`,
				query: 'SELECT * FROM signal WHERE price NOT NULL',
				columnsSelect: ['_ts', 'price', 'ema500', '_m']
			}
		},
		{
			name: 'Sample 2: Temperatures sample (gzip) - 1M timestamps',
			tables: {
				temps: `${baseUrl}/temps_gzip.parquet`,
				query: 'SELECT * FROM temps',
				columnsSelect: ['ts', 'temp']
			}
		},
		{
			name: 'Sample 3: Temperatures sample 2 (gzip) - 100 timestamps',
			tables: {
				temps_mini: `${baseUrl}/temps_gzip_mini.parquet`,
				query: 'SELECT * FROM temps_mini',
				columnsSelect: ['ts', 'temp']
			}
		}
	]);

	onMount(async () => {
		baseUrl = window.location.origin;
	});
</script>

<div class="container">
	<h1>SvelteTimeSeries demo</h1>
	<div>
		<select bind:value={selected}>
			<option value={null}>Select a table</option>
			{#each tables as table, i}
				<option value={i}>
					{table.name}
				</option>
			{/each}
		</select>
	</div>

	{#if selected !== null}
		{#key selected}
			<SvelteTimeSeries table={tables[selected].tables} debug />
		{/key}
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
