<script lang="ts">
	import { DuckDB, type Tables } from '$lib/duckdb/DuckDB';
	import { type EChartsOption, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';
	import { onMount } from 'svelte';

	let { table, debug = true }: { table: Tables; debug: boolean } = $props();

	/**
	 * The `_m` value represents the column where *markers* are stored, and its value indicates the associated table name.
	 * You can assign either a Parquet file or a URL.
	 * If a column is used, it will search for that column across all available tables.
	 * Note that only one *markers* column can exist across all tables.
	 */
	// let tables = $derived<Tables>({
	// 	markers: {
	// 		table: 'signal',
	// 		targetColumn: '_m'
	// 	},
	// 	signal: url
	//  query: 'SELECT _ts, price FROM signal WHERE price NOT NULL'
	// });

	let timeSeriesOption = $state<EChartsOption>({});
	let changes = $state(1);
	let loading = $state(false);

	async function load() {
		loading = true;
		let duckDb = await DuckDB.create(table, debug);
		const timeSeries = new TimeSeriesChartBuilder(timeSeriesOption);
		timeSeries.setLegendIcon('rect');

		const result = await duckDb.query(table.query);
		const rows = result.toArray();

		timeSeries.setDataset(rows);

		if (table.markers) {
			const markers = await duckDb.getMarkers();
			const markersRows = markers.toArray();
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
		}
		loading = false;
	}

	onMount(() => {
		load();
	});
</script>

<div class="container" style="height: 100%;">
	<SVECharts option={timeSeriesOption} {loading} {changes} />
</div>
