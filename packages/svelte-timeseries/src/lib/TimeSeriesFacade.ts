import { TimeSeriesChartBuilder, type TimeSeriesChartAdapter } from '@qtsurfer/sveltecharts';
import { DuckDB, Tables } from './duckdb/DuckDB';

export type Columns = { name: string; checked: boolean }[];

export default class TimeSeriesFacade {
	constructor(
		private duckDb: DuckDB<Tables>,
		private timeSeriesChartBuilder: TimeSeriesChartAdapter
	) {}

	async initialize(table: string, columnesSelect: string) {
		const result = await this.duckDb.getSingleDimension(table, columnesSelect, false);
		this.timeSeriesChartBuilder.setLegendIcon('rect');
		this.timeSeriesChartBuilder.setDataset(result, Object.keys(result));
	}

	async loadMarkers(targetDimension: string) {
		const markersRows = await this.duckDb.getMarkers();

		for (const [i, m] of markersRows.entries()) {
			this.timeSeriesChartBuilder.addMarkerPoint(
				i,
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
		return markersRows;
	}

	async addDimension(table: string, columnesSelect: string) {
		const result = await this.duckDb.getSingleDimension(table, columnesSelect, true);
		this.timeSeriesChartBuilder.addDimension(result, columnesSelect);
	}

	async loadAllColumns(table: string, excludeColumns: string[] = []): Promise<Columns> {
		const excluded = new Set(excludeColumns);
		const columns = this.duckDb.getColumns(table);

		for (const column of columns) {
			if (excluded.has(column) || this.isLoadedColumns(column)) {
				continue;
			}
			await this.addDimension(table, column);
		}

		return this.getColumns(table);
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

	goToTime(ts: number) {
		this.timeSeriesChartBuilder.scrollToTime(ts);
	}

	describe() {
		const legendsActives = this.timeSeriesChartBuilder.getLegendStatus();
		const countData = this.timeSeriesChartBuilder.getTotalRows();
		return [Object.keys(legendsActives).length, countData];
	}

	async toggleMarker(id: number, table: string, shape: string) {
		this.timeSeriesChartBuilder.toggleMarkers(id, table, shape);
	}

	/**
	 * Returns the DuckDB instance for direct queries.
	 * Useful for extracting raw data for external processing (e.g., backtesting).
	 */
	getDuckDB(): DuckDB<Tables> {
		return this.duckDb;
	}

	/**
	 * Returns the chart builder for programmatic chart updates.
	 */
	getChartBuilder(): TimeSeriesChartBuilder {
		if (!(this.timeSeriesChartBuilder instanceof TimeSeriesChartBuilder)) {
			throw new Error('Current chart library does not expose an ECharts TimeSeriesChartBuilder.');
		}
		return this.timeSeriesChartBuilder;
	}

	/**
	 * Returns the chart adapter interface, compatible with both ECharts and Lightweight Charts.
	 * Use this when you don't need ECharts-specific APIs.
	 */
	getChartAdapter(): TimeSeriesChartAdapter {
		return this.timeSeriesChartBuilder;
	}
}
