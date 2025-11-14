<script lang="ts">
	import '../css/main.css';
	import { SvelteTimeSeries } from '$lib';
	import { type MarkersTableOptions, type Tables } from '$lib/duckdb/DuckDB';
	import { Schema } from 'apache-arrow';
	import { onMount } from 'svelte';

	let selected = $state<number | null>(null);
	let baseUrl = $state<string>(typeof window !== 'undefined' ? window.location.href : '');

	type ConfigurationType = {
		duckDb?: {
			schema: Schema;
			columns: string[];
			markers: any[];
		};
		builder?: {
			dimensions: {
				x: string;
				y: string[];
			};
			legendStatus: Record<string, boolean>;
		};
	};

	let configurations = $derived<
		{
			name: string;
			markers?: MarkersTableOptions;
			tables: Tables;
		}[]
	>([
		{
			name: 'Minimal data',
			tables: {
				temps_mini: {
					url: `${baseUrl}temps_gzip_mini.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: '1 million rows data',
			tables: {
				temps: {
					url: `${baseUrl}temps_gzip.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: 'Partial data: Handling up to 1.807.956 values',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}signals.parquet`,
					mainColumn: 'price',
					columnsSelect: ['_ts', 'price', 'VlongBolBW%', 'ema500'] // Limited colums table
				}
			}
		},
		{
			name: 'All data: Handling up to 10.245.084 values',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}signals.parquet`,
					mainColumn: 'price'
				}
			}
		}
	]);

	onMount(async () => {
		baseUrl = window.location.href;
	});
</script>

<div class="grid grid-rows-[auto_1fr] h-screen">
	<div class="bg-primary">
		<div class="text-primary-content text-center text-4xl mt-4 py-4 font-extrabold">
			SvelteTimeSeries <span class="font-extralight text-sm">DEMO</span>
		</div>
		<div class="max-w-md mx-auto py-4">
			<select class="select w-full max-w-md" bind:value={selected}>
				<option value={null}>Select a table</option>
				{#each configurations as config, i}
					<option value={i}>
						{config.name}
					</option>
				{/each}
			</select>
		</div>
	</div>
	<div class="size-full overflow-hidden">
		{#if selected !== null}
			{#key selected}
				{@const configuration = configurations[selected]}
				<SvelteTimeSeries
					table={configuration.tables}
					markers={configuration.markers}
					debug={false}
				/>
			{/key}
		{:else}
			<dvi class="flex items-center justify-center size-full">
				<div class="text-4xl font-light text-stone-400">Select a table</div>
			</dvi>
		{/if}
	</div>
</div>
