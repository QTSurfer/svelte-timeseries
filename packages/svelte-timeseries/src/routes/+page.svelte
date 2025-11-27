<script lang="ts">
	import '../css/main.css';
	import { SvelteTimeSeries } from '$lib';
	import { type MarkersTableOptions, type Tables } from '$lib/duckdb/DuckDB';
	import { Schema } from 'apache-arrow';
	import { onMount } from 'svelte';
	import EyeIcon from '$lib/icon/EyeIcon.svelte';
	import EyeOffIcon from '$lib/icon/EyeOffIcon.svelte';

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

<div class="grid grid-rows-[auto_1fr] h-screen relative">
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
					containerClass="relative grid grid-cols-[200px_1fr] size-full"
					snippetclass="flex flex-col p-2 gap-2 overflow-hidden"
					chartClass="w-full h-full"
				>
					{#snippet columnsSnippet(props)}
						{#if props.columns.length > 0}
							<details
								class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
								name="data"
								open
							>
								<summary class="collapse-title font-semibold"> SCHEMA </summary>
								<div class="collapse-content text-sm p-0 h-100">
									<ul class="list overflow-auto h-full bg-base-100">
										{#each props.columns as column}
											<li class="list-row">
												<div class="list-col-grow">
													{column.name}
												</div>
												<div>
													<label>
														<input
															type="checkbox"
															hidden
															checked={column.checked}
															onchange={() => props.toggleColumn(column.name)}
														/>
														{#if column.checked}
															<div class="swap-on">
																<EyeIcon />
															</div>
														{:else}
															<div class="swap-off">
																<EyeOffIcon />
															</div>
														{/if}
													</label>
												</div>
											</li>
										{/each}
									</ul>
								</div>
							</details>
						{/if}
					{/snippet}

					{#snippet markersSnippet(props)}
						<details
							class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
							name="data"
							open
						>
							<summary class="collapse-title font-semibold"> MARKERS </summary>
							<div class="collapse-content text-sm p-0">
								<ul class="list overflow-auto h-full bg-base-100">
									{#each props.markers as marker, i}
										<li class="list-row">
											<div class="flex items-center">
												<button
													class="btn btn-primary btn-xs"
													onclick={() => props.goToMarker(marker._ts)}
												>
													Go to
												</button>
											</div>
											<div class="list-col-grow">
												<div class="font-bold">{marker.text}</div>
											</div>
											<div class="flex items-center">
												<label class="swap">
													<input
														type="checkbox"
														checked={true}
														onchange={() => props.toggleMarker(i, marker.shape)}
													/>

													<div class="swap-on">
														<EyeIcon />
													</div>
													<div class="swap-off">
														<EyeOffIcon />
													</div>
												</label>
											</div>
										</li>
									{/each}
								</ul>
							</div>
						</details>
					{/snippet}

					{#snippet performanceSnippet(props)}
						<div class="absolute bottom-4 w-full z-10 text-sm pointer-events-none left-0 right-0">
							<div class="mx-auto w-lg text-center py-4 bg-base-300 z-10 p-2 rounded-2xl shadow-md">
								Initial Loading {props.time.toFixed(2)} s | Load Dimensions [{props.matrix[0]} x {props.matrix[1].toLocaleString(
									'es-AR'
								)}]
								<b>{(props.matrix[0] * props.matrix[1]).toLocaleString('es-AR')} values</b>
							</div>
						</div>
					{/snippet}
				</SvelteTimeSeries>
			{/key}
		{:else}
			<dvi class="flex items-center justify-center size-full">
				<div class="text-4xl font-light text-stone-400">Select a table</div>
			</dvi>
		{/if}
	</div>
</div>
