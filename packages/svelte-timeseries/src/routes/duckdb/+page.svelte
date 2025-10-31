<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { DuckDB } from '$lib/duckdb/DuckDB';
	import { type EChartsOption, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

	let { url, debug = true }: { url: string; debug: boolean } = $props();

	let tables = {
		signal: 'http://localhost:5173/signals.parquet'
	};

	let duckDb = $state<DuckDB<typeof tables>>();
	const timeSeries = new TimeSeriesChartBuilder();
	let timeSeriesOption = $state<EChartsOption>({});

	let loading = $state(true);

	async function load() {
		console.log('Load DuckDb...');
		duckDb = await DuckDB.create(tables, debug);
		const result = await duckDb.query(
			`SELECT _ts, price, "vlongBolBW%", "longDistemas%", ema500 FROM signal WHERE price NOT NULL LIMIT 50000`
		);

		const rows = result.toArray();

		timeSeries
			.setTitle('Price')
			.setDataset(rows)
			.setAxisTooltip()
			.setLegendIcon('rect')
			.setGrid({})
			.setSeriesStyle({ smooth: false, symbol: 'none' })
			.addMarkArea([
				{
					name: 'Area 1',
					xAxis: [rows[28000]._ts, rows[29000]._ts]
				}
			])
			.addMarkerEvents([
				{
					name: 'Event 1',
					icon: 'circle',
					xAxis: [rows[35000]._ts]
				},
				{
					name: 'Event 2',
					icon: 'circle',
					xAxis: [rows[39000]._ts]
				}
			])
			.addMarkerPoint(
				{
					dimName: 'price',
					timestamp: rows[35700]._ts,
					name: 'Point 1'
				},
				{
					icon: 'pin'
				}
			);

		timeSeriesOption = timeSeries.build();
		loading = false;
	}

	onMount(async () => {
		await load();
	});
</script>

<div class="container" style="height: 80vh;">
	<SVECharts option={timeSeriesOption} {loading} />
</div>
