<script lang="ts">
	import TimeSeriesFacade, { type Columns } from '$lib/TimeSeriesFacade';
	import { type Snippet } from 'svelte';
	import {
		DuckDB,
		type MarkersTable,
		type MarkersTableOptions,
		type Tables
	} from '../duckdb/DuckDB';
	import { type ECharts, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

	type DataColumnsProps = {
		columns: Columns;
		toggleColumn: (name: string) => void;
		loading: boolean;
	};
	type MarkersProps = {
		markers: MarkersTable[];
		goToMarker: (ts: number) => void;
		toggleMarker: (id: number, shape: string) => void;
	};

	type PerformanceProps = {
		time: number;
		matrix: number[];
	};

	let {
		table,
		markers,
		debug = true,
		columnsSnippet,
		markersSnippet,
		performanceSnippet
	}: {
		table: Tables;
		markers?: MarkersTableOptions;
		debug: boolean;
		columnsSnippet?: Snippet<[DataColumnsProps]>;
		markersSnippet?: Snippet<[MarkersProps]>;
		performanceSnippet?: Snippet<[PerformanceProps]>;
	} = $props();

	let loading = $state(false);
	let timer = $state({ start: performance.now(), end: 0 });

	let timeSeriesFacade = $state<TimeSeriesFacade>();
	const tableName = $derived(Object.keys(table)[0]);

	let columns = $state<Columns>([]);
	let matrix = $state([0, 0]);
	let markersData = $state<MarkersTable[]>([]);

	const onLoad = async (EChartInstance: ECharts) => {
		loading = true;
		const duckDb = await DuckDB.create(table, markers, debug);
		const timeSeriesBuilder = new TimeSeriesChartBuilder(EChartInstance, {
			externalManagerLegend: true
		});
		timeSeriesFacade = new TimeSeriesFacade(duckDb, timeSeriesBuilder);

		const columnsSelect = table[tableName].mainColumn;
		await timeSeriesFacade.initialize(tableName, columnsSelect);

		loading = false;

		if (markers) {
			markersData = await timeSeriesFacade.loadMarkers(markers.targetDimension);
		}

		timer.end = performance.now();
		columns = timeSeriesFacade.getColumns(tableName);
		matrix = timeSeriesFacade.describe();
	};

	async function toggleColumn(name: string) {
		if (!timeSeriesFacade) return;
		loading = true;
		columns = await timeSeriesFacade.toggleColumn(tableName, name);
		matrix = timeSeriesFacade.describe();
		loading = false;
	}

	function toggleMarker(id: number, shape: string) {
		if (!timeSeriesFacade || !markers) return;
		timeSeriesFacade.toggleMarker(id, markers.targetDimension, shape);
	}

	const goToMarker = (ts: number) => {
		if (!timeSeriesFacade) return;
		timeSeriesFacade.goToTime(ts);
	};
	const performanceTimmer = $derived(
		timer.start && timer.end ? (timer.end - timer.start) / 1000 : 0
	);
</script>

{#if performanceTimmer}
	{@render (performanceSnippet ?? renderPerformance)({ time: performanceTimmer, matrix })}
{/if}

<div class="flex h-full">
	<div class="flex flex-col w-1/6 min-w-[200px] gap-2 p-2">
		{@render (columnsSnippet ?? renderColumns)({
			columns,
			toggleColumn,
			loading
		})}

		{#if markersData.length}
			{@render (markersSnippet ?? renderMarkers)({
				markers: markersData,
				goToMarker,
				toggleMarker
			})}
		{/if}
	</div>
	<div class="w-full p-4">
		<SVECharts {onLoad} {loading} />
	</div>
</div>

{#snippet renderColumns(props: DataColumnsProps)}
	{#if props.columns.length > 0}
		<details
			class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
			name="data"
			open
		>
			<summary class="collapse-title font-semibold"> SCHEMA </summary>
			<div class="collapse-content text-sm p-0">
				<ul class="list overflow-auto h-full bg-base-100">
					{#each props.columns as column}
						<li class="list-row">
							<div class="list-col-grow">
								{column.name}
							</div>
							<div>
								<label class="swap swap-rotate">
									<input
										type="checkbox"
										checked={column.checked}
										onchange={() => props.toggleColumn(column.name)}
									/>

									<div class="swap-on">
										<!-- sun icon -->
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
											<g fill="none" stroke="currentColor">
												<path
													d="M12.081 4c-4.664 0-7 4-10.5 8c3.5 4 5.836 8 10.5 8s7-4 10.5-8c-3.5-4-5.836-8-10.5-8Z"
												></path>
												<path d="M9.081 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"></path>
											</g>
										</svg>
									</div>
									<div class="swap-off">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="1.2em"
											height="1.2em"
											viewBox="0 0 14 14"
										>
											<g fill="none" stroke="currentColor">
												<path
													d="M10.165 10.745C12.011 9.571 13.25 7.7 13.25 7c0-1.05-2.798-4.75-6.25-4.75c-1.449 0-2.782.652-3.842 1.486m5.006 7.876A5 5 0 0 1 7 11.75C3.548 11.75.75 8.05.75 7c0-.362.332-1.037.908-1.768"
												></path>
												<path d="M.6.6c4.397 5.632 7.048 8.253 12.8 12.8"></path>
												<path
													d="M5.173 6.043C5.458 5.367 6.086 5 7 5c1.28 0 2 .72 2 2c0 .91-.364 1.536-1.033 1.823"
												></path>
											</g>
										</svg>
									</div>
								</label>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</details>
	{/if}
{/snippet}

{#snippet renderMarkers(props: MarkersProps)}
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
							<button class="btn btn-primary btn-xs" onclick={() => props.goToMarker(marker._ts)}>
								Go to
							</button>
						</div>
						<div class="list-col-grow">
							<div class="font-bold">{marker.text}</div>
						</div>
						<div class="flex items-center">
							<label class="swap swap-rotate">
								<input
									type="checkbox"
									checked={true}
									onchange={() => props.toggleMarker(i, marker.shape)}
								/>

								<div class="swap-on">
									<!-- sun icon -->
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
										<g fill="none" stroke="currentColor">
											<path
												d="M12.081 4c-4.664 0-7 4-10.5 8c3.5 4 5.836 8 10.5 8s7-4 10.5-8c-3.5-4-5.836-8-10.5-8Z"
											></path>
											<path d="M9.081 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"></path>
										</g>
									</svg>
								</div>
								<div class="swap-off">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="1.2em"
										height="1.2em"
										viewBox="0 0 14 14"
									>
										<g fill="none" stroke="currentColor">
											<path
												d="M10.165 10.745C12.011 9.571 13.25 7.7 13.25 7c0-1.05-2.798-4.75-6.25-4.75c-1.449 0-2.782.652-3.842 1.486m5.006 7.876A5 5 0 0 1 7 11.75C3.548 11.75.75 8.05.75 7c0-.362.332-1.037.908-1.768"
											></path>
											<path d="M.6.6c4.397 5.632 7.048 8.253 12.8 12.8"></path>
											<path
												d="M5.173 6.043C5.458 5.367 6.086 5 7 5c1.28 0 2 .72 2 2c0 .91-.364 1.536-1.033 1.823"
											></path>
										</g>
									</svg>
								</div>
							</label>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	</details>
{/snippet}

{#snippet renderPerformance(props: PerformanceProps)}
	<div class="absolute bottom-4 w-full z-10 text-sm pointer-events-none">
		<div class="mx-auto w-lg text-center py-4 bg-base-300 z-10 p-2 rounded-2xl shadow-md">
			Initial Loading {props.time.toFixed(2)} s | Load Dimensions [{props.matrix[0]} x {props.matrix[1].toLocaleString(
				'es-AR'
			)}]
			<b>{(props.matrix[0] * props.matrix[1]).toLocaleString('es-AR')} values</b>
		</div>
	</div>
{/snippet}
