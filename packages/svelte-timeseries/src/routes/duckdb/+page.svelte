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
	});
</script>

<div class="container" style="height: 80vh;">
	<SVECharts option={timeSeriesOption} {loading} />
</div>
