<script lang="ts">
	import { DuckDB, type MarkersTableOptions, type Tables } from '$lib/duckdb/DuckDB';
	import { type ECharts, SVECharts, TimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

	let {
		table,
		markers,
		initialQuery,
		initialTable,
		debug = true,
		readyHandler
	}: {
		table: Tables;
		markers?: MarkersTableOptions;
		initialQuery?: string;
		initialTable?: keyof Tables;
		debug: boolean;
		readyHandler?: (
			echart: ECharts,
			timeSeries: TimeSeriesChartBuilder,
			duckDb: DuckDB<Tables>
		) => void;
	} = $props();

	let loading = $state(false);

	const onLoad = async (EChartInstance: ECharts) => {
		loading = true;
		duckDb = await DuckDB.create(table, markers, debug);
		timeSeries = new TimeSeriesChartBuilder(EChartInstance, {
			externalManagerLegend: true
		});

		const result = initialQuery
			? await duckDb.query(initialQuery)
			: await duckDb.getMainDataByTable(initialTable || Object.keys(table)[0]);

		/**
		 * Optimize data
		 * Transform table object to matrix
		 */
		const [rows, yDimensionsNames] = duckDb.transformTableToMatrix(result);

		timeSeries.setLegendIcon('rect');
		timeSeries.setDataset(rows, yDimensionsNames);

		if (markers) {
			const markersRows = await duckDb.getMarkers();
			for (const m of markersRows) {
				timeSeries.addMarkerPoint(
					{
						dimName: markers.targetDimension,
						timestamp: m._ts,
						name: m.text
					},
					{
						icon: m.shape,
						color: m.color
					}
				);
			}
			timeSeries.build();
		}

		loading = false;
		readyHandler?.(EChartInstance, timeSeries, duckDb);
	};
</script>

<div class="container" style="height: 100%;">
	<SVECharts {onLoad} {loading} />
</div>
