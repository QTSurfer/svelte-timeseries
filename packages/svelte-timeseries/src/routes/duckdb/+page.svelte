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
			`SELECT _ts, price FROM signal WHERE price NOT NULL LIMIT 50000`
		);

		const rows = result.toArray();

		const yDimensions = Object.keys(rows[0]);
		yDimensions.shift();

		/**
		 * @todo Fix this normalization
		 */
		const normalized = rows.map((r) => ({
			...r,
			_ts: Number(r._ts)
		}));
		const table = [...normalized.map(Object.values)];

		console.log(table[28000]);
		console.log(table[29000]);

		timeSeries
			.setTitle('Price')
			.setDataset(table, yDimensions)
			.setAxisTooltip()
			.setLegendIcon('rect')
			.setGrid({})
			.setSeriesStyle({ smooth: false, symbol: 'none' })
			.addMarkArea([
				{
					name: 'Area 1',
					xAxis: [1690656466993, 1690657470867]
				}
			])
			.addMarkerEvents([
				{
					name: 'Event 1',
					icon: 'circle',
					xAxis: [1690653457837]
				},
				{
					name: 'Event 2',
					icon: 'circle',
					xAxis: [1690668504169]
				}
			])
			.addMarkerPoint(
				{
					dimName: 'price',
					timestamp: 1690658472642,
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
