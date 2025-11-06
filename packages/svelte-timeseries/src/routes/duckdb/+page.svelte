<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { DuckDB } from '$lib/duckdb/DuckDB';
	import { type EChartsOption, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

	let { url, debug = true }: { url: string; debug: boolean } = $props();

	/**
	 * The `_m` value represents the column where *markers* are stored, and its value indicates the associated table name.
	 * You can assign either a Parquet file or a URL.
	 * If a column is used, it will search for that column across all available tables.
	 * Note that only one *markers* column can exist across all tables.
	 */
	let tables = {
		markers: {
			table: 'signal',
			targetColumn: '_m'
		},
		signal: 'http://localhost:5173/signals.parquet'
	};

	let duckDb = $state<DuckDB<typeof tables>>();
	let timeSeriesOption = $state<EChartsOption>({});
	const timeSeries = new TimeSeriesChartBuilder(timeSeriesOption);
	let changes = $state(0);
	let loading = $state(true);

	async function load() {
		console.log('Load DuckDb...');
		duckDb = await DuckDB.create(tables, debug);

		timeSeries.setTitle('Price').setLegendIcon('rect');
		const result = await duckDb.query(`SELECT _ts, price FROM signal WHERE price NOT NULL`);
		const markers = await duckDb.getMarkers();

		const markersRows = markers.toArray();
		const rows = result.toArray();
		timeSeries.setDataset(rows);
		for (const m of markersRows) {
			timeSeries.addMarkerPoint(
				{
					dimName: 'price',
					timestamp: m._ts,
					name: m.text
				},
				{
					icon: m.shape,
					color: m.color
				}
			);
		}
		changes++;
		await Promise.all([duckDb.closeConnection(), tick()]);
		loading = false;
	}

	onMount(() => {
		load();
	});
</script>

<div class="container" style="height: 80vh;">
	<SVECharts option={timeSeriesOption} {loading} {changes} />
</div>

<style>
	.spinner {
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
