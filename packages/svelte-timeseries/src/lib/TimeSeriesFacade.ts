import {
	TimeSeriesChartBuilder,
	VelaTimeSeriesChartBuilder,
	type ChartDatasetFormatSimpleObject,
	type TimeSeriesChartAdapter
} from '@qtsurfer/sveltecharts';
import { DuckDB, Tables } from './duckdb/DuckDB';
import type { OHLCColumns, OHLCResolution } from './duckdb/ohlc';
import type { DataRange } from './duckdb/types';

export type Columns = { name: string; checked: boolean }[];

interface ViewportSettings {
	maxPoints: number;
	reloadThreshold: number;
}

export default class TimeSeriesFacade {
	private _dataRange: DataRange | null = null;
	private _fullDataRange: DataRange | null = null;
	private _requestedDataRange: DataRange | null = null;
	private _requestedDimensions = new Set<string>();
	private _currentTable: string = '';
	private _ohlcMode: { columns: OHLCColumns; resolution?: OHLCResolution } | null = null;
	private _settings: ViewportSettings = { maxPoints: 500000, reloadThreshold: 0.1 };
	private _dataRequestId = 0;

	constructor(
		private duckDb: DuckDB<Tables>,
		private timeSeriesChartBuilder: TimeSeriesChartAdapter
	) {}

	async initialize(table: string, columnsSelect: string) {
		this.resetViewportState(table);
		this.timeSeriesChartBuilder.setLegendIcon('rect');

		const ohlc = this.duckDb.resolveOHLC(table);
		if (ohlc) {
			const resolution = this.duckDb.getTable(table).resolution;
			this._ohlcMode = { columns: ohlc, resolution };
			const result = await this.duckDb.getOHLC(table, ohlc, resolution);
			this.timeSeriesChartBuilder.setCandlestickSeries(result, ohlc);
			this.captureFullDataRange();
			return;
		}

		if (this.timeSeriesChartBuilder instanceof VelaTimeSeriesChartBuilder) {
			throw new Error(
				`Table "${table}" has no OHLC columns to render as a candlestick series. ` +
					'The Vela chart engine only supports candlestick data — pick a different chart engine for this table.'
			);
		}

		const result = await this.duckDb.getSingleDimension(table, columnsSelect, false);
		this.timeSeriesChartBuilder.setDataset(result, Object.keys(result));
		this.captureFullDataRange();
	}

	async onViewportChange(start: number, end: number) {
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
		const requestId = ++this._dataRequestId;
		const range = { start, end };
		this._requestedDataRange = range;

		if (this._dataRange) {
			const size = end - start;
			const moved = Math.abs(this._dataRange.start - start) / size;
			const zoomed = Math.abs(this._dataRange.end - this._dataRange.start - size) / size;
			if (moved < this._settings.reloadThreshold && zoomed < this._settings.reloadThreshold) {
				return;
			}
		}

		const requestedDimensions = this.getRequestedDimensions();
		if (!requestedDimensions.length) return;

		const data = this._ohlcMode
			? await this.duckDb.getWindowedOHLC(
					this._currentTable,
					requestedDimensions,
					this._ohlcMode.columns,
					this._ohlcMode.resolution,
					range,
					this._settings.maxPoints
				)
			: await this.duckDb.getWindowedData(
					this._currentTable,
					requestedDimensions,
					range,
					this._settings.maxPoints
				);

		if (requestId !== this._dataRequestId) return;

		this.applyWindowData(data, requestedDimensions);
		this._dataRange = range;
	}

	async onViewportPercentageChange(start: number, end: number) {
		if (!this._fullDataRange) return;
		const width = this._fullDataRange.end - this._fullDataRange.start;
		await this.onViewportChange(
			this._fullDataRange.start + width * (start / 100),
			this._fullDataRange.start + width * (end / 100)
		);
	}

	private captureFullDataRange() {
		const [start, end] = this.timeSeriesChartBuilder.getRangeValues();
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
		this._fullDataRange = { start, end };
		this.timeSeriesChartBuilder.setDataRange?.(start, end);
	}

	private resetViewportState(table: string) {
		this._dataRequestId++;
		this._dataRange = null;
		this._fullDataRange = null;
		this._requestedDataRange = null;
		this._requestedDimensions.clear();
		this._currentTable = table;
		this._ohlcMode = null;
	}

	private getRequestedDimensions(): string[] {
		const dimensions = new Set(this.getLoadedDimensions());
		for (const dimension of this._requestedDimensions) dimensions.add(dimension);
		return [...dimensions];
	}

	private getLoadedDimensions(): string[] {
		return (
			this.timeSeriesChartBuilder.getLoadedDimensions?.() ??
			this.timeSeriesChartBuilder.getActiveDimensions()
		);
	}

	private applyWindowData(data: ChartDatasetFormatSimpleObject, requestedDimensions: string[]) {
		const loadedDimensions = this.getLoadedDimensions();
		if (this.timeSeriesChartBuilder.updateDimensions) {
			this.timeSeriesChartBuilder.updateDimensions(data, loadedDimensions);
		} else {
			for (const dimension of loadedDimensions) {
				this.timeSeriesChartBuilder.updateDimension(data, dimension);
			}
		}

		const loaded = new Set(loadedDimensions);
		for (const dimension of requestedDimensions) {
			if (loaded.has(dimension)) continue;
			const values = data[dimension];
			if (!values) throw new Error(`Dimension not found in windowed data: ${dimension}`);
			this.timeSeriesChartBuilder.addDimension({ [dimension]: values }, dimension);
		}
	}

	setViewportSettings(settings: Partial<ViewportSettings>) {
		if (
			settings.maxPoints !== undefined &&
			(!Number.isFinite(settings.maxPoints) ||
				!Number.isInteger(settings.maxPoints) ||
				settings.maxPoints <= 0)
		) {
			throw new Error('maxPoints must be a finite positive integer.');
		}
		Object.assign(this._settings, settings);
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

	async addDimension(table: string, columnsSelect: string) {
		this._requestedDimensions.add(columnsSelect);
		const requestId = ++this._dataRequestId;
		const range =
			table === this._currentTable ? (this._requestedDataRange ?? this._dataRange) : null;

		if (!range) {
			const result = await this.duckDb.getSingleDimension(table, columnsSelect, true);
			if (requestId !== this._dataRequestId) return;
			this.timeSeriesChartBuilder.addDimension(result, columnsSelect);
			return;
		}

		const requestedDimensions = this.getRequestedDimensions();
		const data = await this.duckDb.getWindowedData(
			table,
			requestedDimensions,
			range,
			this._settings.maxPoints
		);
		if (requestId !== this._dataRequestId) return;

		this.applyWindowData(data, requestedDimensions);
		this._dataRange = range;
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

	getDuckDB(): DuckDB<Tables> {
		return this.duckDb;
	}

	getChartBuilder(): TimeSeriesChartBuilder | undefined {
		if (!(this.timeSeriesChartBuilder instanceof TimeSeriesChartBuilder)) {
			return undefined;
		}
		return this.timeSeriesChartBuilder;
	}

	getChartAdapter(): TimeSeriesChartAdapter {
		return this.timeSeriesChartBuilder;
	}

	/**
	 * Whether the active table resolved to an OHLC candlestick series (explicit
	 * `candlestick` config, or column-name auto-detection) after `initialize`. This is
	 * the real, post-load answer — unlike a table's static config, it also covers
	 * auto-detected OHLC columns, which can only be confirmed once the file is loaded.
	 */
	isOHLCMode(): boolean {
		return this._ohlcMode !== null;
	}
}
