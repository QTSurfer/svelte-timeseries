import { TimeSeriesChartBuilder, type ECharts } from '@qtsurfer/sveltecharts';
import { DuckDB, Tables } from './duckdb/DuckDB';

export type Columns = { name: string; checked: boolean }[];

export default class timeSeriesFacade {
	constructor(
		private duckDb: DuckDB<Tables>,
		private timeSeriesChartBuilder: TimeSeriesChartBuilder
	) {}

	async initialize(table: string, columnesSelect: string) {
		const result = await this.duckDb.getSingleDimension(table, columnesSelect, false);
		this.timeSeriesChartBuilder.setLegendIcon('rect');
		this.timeSeriesChartBuilder.setDataset(result, Object.keys(result));
	}

	async loadMarkers(targetDimension: string) {
		const markersRows = await this.duckDb.getMarkers();

		for (const m of markersRows) {
			this.timeSeriesChartBuilder.addMarkerPoint(
				{
					dimName: targetDimension,
					timestamp: m._ts,
					name: m.text
				},
				{
					icon: m.shape,
					color: m.color
				}
			);
		}
		this.timeSeriesChartBuilder.build();
	}

	async addDimension(table: string, columnesSelect: string) {
		const result = await this.duckDb.getSingleDimension(table, columnesSelect, true);
		this.timeSeriesChartBuilder.addDimension(result, columnesSelect);
	}

	getColumns(table: string): Columns {
		const columns = this.duckDb.getColumns(table);
		const selected = this.timeSeriesChartBuilder.getLegendStatus();

		return columns.map((c) => ({ name: c, checked: Boolean(selected[c]) }));
	}

	isLoadedColumns(column: string) {
		const selected = this.timeSeriesChartBuilder.getLegendStatus();
		return Object.keys(selected).includes(column);
	}

	async toggleColumn(table: string, column: string): Promise<Columns> {
		if (this.isLoadedColumns(column)) {
			this.timeSeriesChartBuilder.toggleLegend(column);
		} else {
			await this.addDimension(table, column);
		}
		return this.getColumns(table);
	}

	describe() {
		const legendsActives = this.timeSeriesChartBuilder.getLegendStatus();
		const countData = this.timeSeriesChartBuilder.getTotalRows();
		return [Object.keys(legendsActives).length, countData];
	}
}
