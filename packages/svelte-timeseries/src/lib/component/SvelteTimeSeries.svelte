<script lang="ts" module>
	// Required so Tailwind v4 recognizes this file as a Svelte component and does not parse it as CSS
</script>

<script lang="ts">
	import TimeSeriesFacade from '$lib/TimeSeriesFacade';
	import type { Columns } from '$lib/TimeSeriesFacade';
	import type { Snippet } from 'svelte';
	import { DuckDB } from '../duckdb/DuckDB';
	import type { MarkersTable, MarkersTableOptions, Tables } from '../duckdb/DuckDB';
	import {
		LightweightTimeSeriesChartBuilder,
		SVECharts,
		SVELightweightCharts,
		SVEVelaCharts,
		TimeSeriesChartBuilder,
		VelaTimeSeriesChartBuilder
	} from '@qtsurfer/sveltecharts';
	import type {
		ECharts,
		LightweightChartApi,
		TimeSeriesChartAdapter,
		VelaChartApi
	} from '@qtsurfer/sveltecharts';

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
		externalManagerLegend = true,
		columnsSnippet,
		markersSnippet,
		performanceSnippet,
		containerClass,
		snippetClass,
		chartClass,
		chartLibrary = 'echarts',
		isDark,
		onFacadeReady,
		loadingSnippet
	}: {
		table: Tables;
		markers?: MarkersTableOptions;
		debug: boolean;
		externalManagerLegend?: boolean;
		columnsSnippet?: Snippet<[DataColumnsProps]>;
		markersSnippet?: Snippet<[MarkersProps]>;
		performanceSnippet?: Snippet<[PerformanceProps]>;
		containerClass?: string;
		snippetClass?: string;
		chartClass?: string;
		chartLibrary?: 'echarts' | 'lightweight' | 'vela';
		isDark?: boolean;
		onFacadeReady?: (facade: TimeSeriesFacade) => void;
		loadingSnippet?: Snippet;
	} = $props();

	let loading = $state(false);
	let loadError = $state('');
	let timer = $state({ start: performance.now(), end: 0 });

	let timeSeriesFacade = $state<TimeSeriesFacade>();
	const tableName = $derived(Object.keys(table)[0]);

	let columns = $state<Columns>([]);
	let matrix = $state([0, 0]);
	let visibleRows = $state(0);
	let markersData = $state<MarkersTable[]>([]);
	let loadToken = 0;

	const loadChart = async (chartBuilder: TimeSeriesChartAdapter) => {
		const currentTable = Object.keys(table)[0];
		const entry = currentTable ? table[currentTable] : undefined;
		if (!entry) return;
		const columnsSelect = entry.mainColumn;
		const myToken = ++loadToken;

		loading = true;
		loadError = '';
		const duckDb = await DuckDB.create(table, markers, debug);
		const discardIfStale = (): boolean => {
			if (myToken === loadToken) return false;
			duckDb.closeConnection().catch(() => {});
			return true;
		};
		if (discardIfStale()) return;

		try {
			const facade = new TimeSeriesFacade(duckDb, chartBuilder);
			await facade.initialize(currentTable, columnsSelect);
			if (discardIfStale()) return;

			if (!externalManagerLegend) {
				await facade.loadAllColumns(currentTable, [columnsSelect]);
				if (discardIfStale()) return;
			}

			let newMarkers: MarkersTable[] | undefined;
			if (markers) {
				newMarkers = await facade.loadMarkers(markers.targetDimension);
				if (discardIfStale()) return;
			}

			timeSeriesFacade = facade;
			if (newMarkers) markersData = newMarkers;
			columns = facade.getColumns(currentTable);
			matrix = facade.describe();
			visibleRows = matrix[1];
			timer.end = performance.now();
			onFacadeReady?.(facade);
		} catch (error) {
			if (discardIfStale()) return;
			loadError = error instanceof Error ? error.message : 'Failed to load the chart.';
			if (debug) console.error(error);
		} finally {
			if (myToken === loadToken) loading = false;
		}
	};

	const onLoadECharts = async (EChartInstance: ECharts) => {
		const timeSeriesBuilder = new TimeSeriesChartBuilder(EChartInstance, {
			externalManagerLegend
		});
		await loadChart(timeSeriesBuilder);
	};

	const onDataZoom = ({ start, end }: { start: number; end: number }) => {
		if (!timeSeriesFacade) return;
		void timeSeriesFacade
			.onViewportPercentageChange(start, end)
			.then(() => {
				visibleRows = timeSeriesFacade?.describe()[1] ?? visibleRows;
			})
			.catch((error) => {
				if (debug) console.error('Failed to reload the chart viewport.', error);
			});
	};

	const onLoadLightweight = async (chartInstance: LightweightChartApi) => {
		const timeSeriesBuilder = new LightweightTimeSeriesChartBuilder(chartInstance, {
			externalManagerLegend
		});
		await loadChart(timeSeriesBuilder);
	};

	const onLoadVela = async (chartInstance: VelaChartApi) => {
		const timeSeriesBuilder = new VelaTimeSeriesChartBuilder(chartInstance);
		await loadChart(timeSeriesBuilder);
	};

	async function toggleColumn(name: string) {
		if (!timeSeriesFacade) return;
		loading = true;
		loadError = '';
		try {
			columns = await timeSeriesFacade.toggleColumn(tableName, name);
			matrix = timeSeriesFacade.describe();
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Failed to toggle the column.';
			if (debug) console.error(error);
		} finally {
			loading = false;
		}
	}

	function toggleMarker(id: number, shape: string) {
		if (!timeSeriesFacade || !markers) return;
		timeSeriesFacade.toggleMarker(id, markers.targetDimension, shape);
	}

	const goToMarker = (ts: number) => {
		if (!timeSeriesFacade) return;
		timeSeriesFacade.goToTime(ts);
	};
	const performanceTimer = $derived(
		timer.start && timer.end ? (timer.end - timer.start) / 1000 : 0
	);
</script>

<div id="svelte-timeseries" class={containerClass} data-visible-rows={visibleRows}>
	<div class={snippetClass}>
		{#if performanceTimer}
			{@render performanceSnippet?.({ time: performanceTimer, matrix })}
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
		{#if chartLibrary === 'lightweight'}
			<SVELightweightCharts onLoad={onLoadLightweight} {loading} {isDark} />
		{:else if chartLibrary === 'vela'}
			<SVEVelaCharts onLoad={onLoadVela} {loading} {isDark} />
		{:else}
			<SVECharts onLoad={onLoadECharts} {onDataZoom} {loading} {isDark} />
		{/if}
	</div>
	{#if loading}
		{#if loadingSnippet}
			{@render loadingSnippet()}
		{:else}
			<div class="wrapper-loading">
				<div class="spinner"></div>
			</div>
		{/if}
	{/if}
	{#if loadError}
		<div class="wrapper-error">{loadError}</div>
	{/if}
</div>

{#snippet renderColumns(props: DataColumnsProps)}
	{#if props.columns.length > 0}
		<details class="sts-details">
			<summary> SCHEMA </summary>
			<div>
				<ul>
					{#each props.columns as column (column.name)}
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
			{#each props.markers as marker, i (i)}
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
		border: 4px solid #ccc;
		border-top-color: #1d72b8;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: auto;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.wrapper-error {
		position: absolute;
		left: 1rem;
		right: 1rem;
		top: 1rem;
		z-index: 3;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background-color: rgba(220, 38, 38, 0.1);
		border: 1px solid rgba(220, 38, 38, 0.4);
		color: #dc2626;
		font-size: 0.875rem;
	}
</style>
