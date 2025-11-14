<script lang="ts">
	import TimeSeriesFacade, { type Columns } from '$lib/TimeSeriesFacade';
	import { type Snippet } from 'svelte';
	import { DuckDB, type MarkersTableOptions, type Tables } from '../duckdb/DuckDB';
	import { type ECharts, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

	type DataColumnsProps = {
		columns: Columns;
		toggleColumn: (name: string) => void;
		loading: boolean;
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
		performanceSnippet
	}: {
		table: Tables;
		markers?: MarkersTableOptions;
		debug: boolean;
		columnsSnippet?: Snippet<[DataColumnsProps]>;
		performanceSnippet?: Snippet<[PerformanceProps]>;
	} = $props();

	let loading = $state(false);
	let timer = $state({ start: performance.now(), end: 0 });

	let timeSeriesFacade = $state<TimeSeriesFacade>();
	const tableName = $derived(Object.keys(table)[0]);

	let columns = $state<Columns>([]);
	let matrix = $state([0, 0]);

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
			await timeSeriesFacade.loadMarkers(markers.targetDimension);
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

	const performanceTimmer = $derived(
		timer.start && timer.end ? (timer.end - timer.start) / 1000 : 0
	);
</script>

<div class="flex h-full">
	<div class="w-1/6 overflow-auto flex items-center flex-col justify-center">
		{#if performanceTimmer}
			{@render (performanceSnippet ?? dataPerformance)({ time: performanceTimmer, matrix })}
		{/if}
		{@render (columnsSnippet ?? dataColumns)({
			columns,
			toggleColumn,
			loading
		})}
	</div>
	<div class="w-full p-4">
		<SVECharts {onLoad} {loading} />
	</div>
</div>

{#snippet dataPerformance(props: PerformanceProps)}
	<div class="text-sm text-center py-4">
		<div class="py-2">Initial Loading {props.time.toFixed(2)} s</div>
		<hr />
		<div class="py-2">
			<div>Load Dimensions</div>
			<div>
				[{props.matrix[0]} x {props.matrix[1].toLocaleString('es-AR')}]
				<b>{(props.matrix[0] * props.matrix[1]).toLocaleString('es-AR')} values</b>
			</div>
		</div>
	</div>
{/snippet}

{#snippet dataColumns(props: DataColumnsProps)}
	{#if props.columns}
		<div class="flex flex-col gap-y-2 p-4">
			{#each props.columns as column}
				<label class="label">
					<input
						onchange={() => props.toggleColumn(column.name)}
						type="checkbox"
						checked={column.checked}
						class="toggle"
					/>
					{column.name}
				</label>
			{/each}
		</div>
	{/if}
{/snippet}
