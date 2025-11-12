<script lang="ts">
	import { SvelteTimeSeries } from '$lib';
	import { DuckDB, type MarkersTableOptions, type Tables } from '$lib/duckdb/DuckDB';
	import { type ECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';
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

	let infoTable = $state<Record<string, ConfigurationType>>({});

	let configurations = $derived<
		{
			name: string;
			markers?: MarkersTableOptions;
			tables: Tables;
			initialQuery?: string;
			initialTable?: string;
		}[]
	>([
		{
			name: 'Minimal configuration: Temperatures - 100 timestamps',
			tables: {
				temps_mini: {
					url: `${baseUrl}/temps_gzip_mini.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: 'Minimal configuration: Temperatures - 1M timestamps',
			tables: {
				temps: {
					url: `${baseUrl}/temps_gzip.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: 'Medium configuration: With markers and Column selection',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}/signals.parquet`,
					mainColumn: 'price',
					columnsSelect: ['_ts', 'price']
				}
			}
		},
		{
			name: 'Advance configuration: Custom query and optimized column selection',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}/signals.parquet`,
					mainColumn: 'price',
					columnsSelect: ['_ts', 'price', 'VlongBolBW%', 'ema500']
				}
			},
			initialQuery: `SELECT * FROM signal WHERE price IS NOT NULL LIMIT 300000 OFFSET 100000`
		},
		{
			name: 'Medium configuration: All data',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}/signals.parquet`,
					mainColumn: 'price'
				}
			}
		}
	]);

	onMount(async () => {
		baseUrl = window.location.href;
	});

	let db = $state<DuckDB<Tables>>();
	let timeSeriesChartBuilder = $state<TimeSeriesChartBuilder>();
	let echart = $state<ECharts>();

	$effect(() => {
		if (selected !== null) {
			infoTable = {};
		}
	});

	const loadDataSchema = async (
		timeSeriesInstance: TimeSeriesChartBuilder,
		duckDbInstance: DuckDB<Tables>
	) => {
		if (!timeSeriesInstance || !duckDbInstance || selected === null) return;

		db = duckDbInstance;
		timeSeriesChartBuilder = timeSeriesInstance;
		echart = timeSeriesChartBuilder.ECharts;

		console.log(timeSeriesChartBuilder.getLegendStatus());
		const config = configurations[selected];

		for (const table of Object.keys(config.tables)) {
			const schema = db.getSchema(table);
			const columns = db.getColumns(table);
			const markers = await db.getMarkers();

			infoTable = {
				[table]: {
					duckDb: { schema, columns, markers },
					builder: {
						legendStatus: timeSeriesInstance.getLegendStatus() ?? {},
						dimensions: timeSeriesInstance.getDimensionKeys()
					}
				}
			};
		}
	};
</script>

<div class="container">
	<h1>SvelteTimeSeries demo</h1>
	<div>
		<select bind:value={selected}>
			<option value={null}>Select a table</option>
			{#each configurations as config, i}
				<option value={i}>
					{config.name}
				</option>
			{/each}
		</select>
	</div>

	<div style="display: flex; height: 100%;">
		{#if selected !== null}
			{#key selected}
				{@const configuration = configurations[selected]}
				<div style="width: 20%; overflow-y: scroll;">
					{#each Object.keys(configuration.tables) as table, i}
						<h6>Table {i}: {table}</h6>
						{#if timeSeriesChartBuilder}
							<h3>TimeSeriesChartBuilder CLASS</h3>
							{#if infoTable[table]?.builder}
								{#each Object.entries(infoTable[table]?.builder.legendStatus) as [name, status]}
									<div>
										<label>
											<input
												type="checkbox"
												value={status}
												checked={status}
												onchange={() => timeSeriesChartBuilder?.toggleLegend(name)}
											/>{name} ({status.toString()})
										</label>
									</div>
								{/each}
							{:else}
								<div>Cargando datos builder de <em>{table}</em>…</div>
							{/if}
						{/if}
					{/each}
				</div>

				<div style="flex: 1 1 0%;">
					<SvelteTimeSeries
						table={configuration.tables}
						markers={configuration.markers}
						initialQuery={configuration.initialQuery}
						debug={false}
						readyHandler={loadDataSchema}
					/>
				</div>
			{/key}
		{/if}
	</div>
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
