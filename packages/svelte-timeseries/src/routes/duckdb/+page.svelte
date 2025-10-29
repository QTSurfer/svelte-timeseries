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

	// let duckChart: DuckChart;
	// let chart: SVECharts;

	let loading = $state(true);

	async function load() {
		console.log('Load DuckDb...');
		duckDb = await DuckDB.create(tables, debug);
		const result = await duckDb.query(`SELECT _ts, price FROM signal WHERE price NOT NULL`);

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

		console.log('table loaded');

		await tick();
		timeSeries
			.setTitle('Tempp', 'Last 24 hours')
			.setDataset(table, yDimensions)
			.setAxisTooltip()
			.setLegendIcon('rect')
			.setGrid({})
			.setSeriesStyle({ smooth: false, symbol: 'none' });

		timeSeriesOption = timeSeries.build();
		loading = false;
	}

	onMount(async () => {
		await load();
		// console.log('Mounting DuckDb...');
		// duckDb = await DuckDB.create(tables, debug);
		// 	duckChart = new DuckChart();
		// 	duckChart.debug = debug;
		// 	loadUrl(url);
	});

	// const loadUrl = async (url: string) => {
	// 	if (!url || url === '') return;
	// 	if (!duckChart) return;
	// 	loading = true;
	// 	await duckChart.initDB(url);
	// 	await duckChart.load(url);
	// 	duckChart.option = { ...duckChart.option }; // Force Svelte reactivity
	// 	loading = false;
	// };
	// $: if (url) {
	// 	loadUrl(url);
	// }
</script>

<div class="container" style="height: 80vh;">
	<SVECharts option={timeSeriesOption} {loading} />
</div>
