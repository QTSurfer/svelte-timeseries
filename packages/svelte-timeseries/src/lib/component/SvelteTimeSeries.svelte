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
		performanceSnippet,
		containerClass,
		snippetclass,
		chartClass,
		isDark
	}: {
		table: Tables;
		markers?: MarkersTableOptions;
		debug: boolean;
		columnsSnippet?: Snippet<[DataColumnsProps]>;
		markersSnippet?: Snippet<[MarkersProps]>;
		performanceSnippet?: Snippet<[PerformanceProps]>;
		containerClass?: string;
		snippetclass?: string;
		chartClass?: string;
		isDark?: boolean;
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

<div id="svelte-timeseries" class={containerClass}>
	<div class={snippetclass}>
		{#if performanceTimmer}
			{@render performanceSnippet?.({ time: performanceTimmer, matrix })}
		{/if}

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

	<div class={chartClass}>
		<SVECharts {onLoad} {loading} {isDark} />
	</div>
	{#if loading}
		<div class="wrapper-loading">
			<div class="spinner"></div>
		</div>
	{/if}
</div>

{#snippet renderColumns(props: DataColumnsProps)}
	{#if props.columns.length > 0}
		<details class="sts-details">
			<summary> SCHEMA </summary>
			<div>
				<ul>
					{#each props.columns as column}
						<li>
							<div>
								{column.name}
							</div>
							<div>
								<label>
									<input
										type="checkbox"
										checked={column.checked}
										onchange={() => props.toggleColumn(column.name)}
									/>
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
	<details class="sts-details">
		<summary> MARKERS </summary>
		<ul>
			{#each props.markers as marker, i}
				<li>
					<div>
						<b>{marker.text}</b>
					</div>

					<div>
						<label>
							<input
								type="checkbox"
								checked={true}
								onchange={() => props.toggleMarker(i, marker.shape)}
							/>
						</label>

						<button onclick={() => props.goToMarker(marker._ts)}> Go to </button>
					</div>
				</li>
			{/each}
		</ul>
	</details>
{/snippet}

<style>
	.wrapper-loading {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		background-color: rgba(255, 255, 255, 0.5);
		z-index: 2;
		display: flex;
		justify-content: center;
		align-items: center;
	}
	.wrapper-loading .spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #ccc; /* Color del borde */
		border-top-color: #1d72b8; /* Color del borde superior */
		border-radius: 50%;
		animation: spin 0.8s linear infinite; /* Animación */
		margin: auto; /* Centrar en el contenedor si es necesario */
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
