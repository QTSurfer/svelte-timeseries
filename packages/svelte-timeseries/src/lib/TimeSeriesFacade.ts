import {
	TimeSeriesChartBuilder,
	VelaTimeSeriesChartBuilder,
	type ChartDatasetFormatSimpleObject,
	type TimeSeriesChartAdapter
} from '@qtsurfer/sveltecharts';
import type { DuckDB, Tables } from './duckdb/DuckDB';
import type { OHLCColumns, OHLCResolution } from './duckdb/ohlc';
import type { DataRange } from './duckdb/types';

export type Columns = { name: string; checked: boolean }[];

const DAY_MS = 86_400_000;

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
	/** `price` is set when the bars are aggregated from the ticks of that column (ticker feeds). */
	private _ohlcMode: { columns: OHLCColumns; resolution?: OHLCResolution; price?: string } | null =
		null;
	private _settings: ViewportSettings = { maxPoints: 500000, reloadThreshold: 0.1 };
	private _dataRequestId = 0;

	constructor(
		private duckDb: DuckDB<Tables>,
		private timeSeriesChartBuilder: TimeSeriesChartAdapter
	) {}

	async initialize(table: string, columnsSelect: string) {
		this.resetViewportState(table);
		this.timeSeriesChartBuilder.setLegendIcon('rect');

		// A ticker feed keeps rolling 24-hour statistics in its open / high / low columns, so its
		// candles are aggregated from the price column. Without a resolution there is nothing to
		// aggregate into: draw the price as a line (what `resolveOHLC` leaves to the code below).
		const ticker = this.duckDb.resolveTickCandles(table);
		if (ticker?.resolution) {
			this._ohlcMode = {
				columns: ticker.columns,
				resolution: ticker.resolution,
				price: ticker.price
			};
			const result = await this.duckDb.getOHLC(
				table,
				ticker.columns,
				ticker.resolution,
				ticker.price
			);
			this.timeSeriesChartBuilder.setCandlestickSeries(result, ticker.columns);
			this.captureFullDataRange();
			return;
		}
		if (ticker) {
			const reason = ticker.detected
				? 'looks like a ticker feed: its open / high / low columns are rolling statistics, not bar prices, so they are not drawn as candles'
				: 'asks for candles from a price column';
			console.warn(
				`[svelte-timeseries] "${table}" ${reason}. Set "resolution" (for example "1m") to aggregate "${ticker.price}" into candles. Until then the price is drawn as a line; set "candlestick: false" to skip this notice.`
			);
		}

		const ohlc = ticker ? undefined : this.duckDb.resolveOHLC(table);
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
			? await this.fetchWindowedOHLC(requestedDimensions, range)
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

	/**
	 * The whole data range, widened by a day on each side. A stopgap: windows are compared with a
	 * timestamp without a time zone, which on a time-zone-aware time column is read in the session's
	 * time zone and shifts the window by its UTC offset (a whole-hour offset, at most 14 hours). The
	 * padding keeps "all data" from losing its first or last hours. Remove it once the window
	 * comparison itself is time-zone safe.
	 */
	private paddedFullDataRange(): DataRange | null {
		const full = this._fullDataRange;
		if (!full) return null;
		return { start: full.start - DAY_MS, end: full.end + DAY_MS };
	}

	private fetchWindowedOHLC(columns: string[], range: DataRange) {
		const mode = this._ohlcMode;
		if (!mode) throw new Error('Candlestick mode is not active.');
		const args = [this._currentTable, columns, mode.columns, mode.resolution, range] as const;
		return mode.price === undefined
			? this.duckDb.getWindowedOHLC(...args, this._settings.maxPoints)
			: this.duckDb.getWindowedOHLC(...args, this._settings.maxPoints, mode.price);
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

	/**
	 * Loads a single dimension as its own series, unconditionally — unlike `addDimension`, this
	 * doesn't bump or check `_dataRequestId`. It exists specifically for `loadChart`'s
	 * OHLC-mode-markers bootstrap step (loading `markers.targetDimension` before `loadMarkers`
	 * resolves against it), which runs immediately after `initialize()`, before any viewport-
	 * driven request has a `_dataRange` to race against. Using `addDimension` there was a real,
	 * intermittent bug: the chart can fire its own initial `onViewportChange` (e.g. ECharts'
	 * dataZoom component reporting its starting state right after mount) while that call's
	 * `getSingleDimension` query is still in flight, bumping `_dataRequestId` first — making
	 * `addDimension`'s own staleness check silently drop the dimension it just fetched, so
	 * `loadMarkers` then failed with "Dimension not found".
	 */
	async ensureDimensionLoaded(table: string, columnsSelect: string) {
		const result = await this.duckDb.getSingleDimension(table, columnsSelect, true);
		this.timeSeriesChartBuilder.addDimension(result, columnsSelect);
	}

	/**
	 * Makes `targetDimension` something `loadMarkers` can anchor to. In OHLC mode the open / high /
	 * low / close columns already are: every engine anchors a marker on those to the candles, so
	 * loading one as an extra line would only draw a duplicate line and take the markers off the
	 * candles. Any other column (an indicator, for instance) is not a series of its own in OHLC
	 * mode, so it is loaded first. Does nothing outside OHLC mode: a plain table's main column is
	 * already a series. Returns whether a column was loaded.
	 */
	async ensureMarkerTargetLoaded(table: string, targetDimension: string): Promise<boolean> {
		if (
			this._ohlcMode === null ||
			this.isOHLCColumn(targetDimension) ||
			this.isLoadedColumns(targetDimension)
		) {
			return false;
		}
		await this.ensureDimensionLoaded(table, targetDimension);
		return true;
	}

	async addDimension(table: string, columnsSelect: string) {
		this._requestedDimensions.add(columnsSelect);
		const requestId = ++this._dataRequestId;
		// Resampled candles have a different number of rows than the raw table, so a column added on
		// top of them has to be fetched resampled too, over the whole range if nothing is zoomed yet.
		const resampled = this._ohlcMode?.resolution !== undefined;
		const range =
			table === this._currentTable
				? (this._requestedDataRange ??
					this._dataRange ??
					(resampled ? this.paddedFullDataRange() : null))
				: null;

		if (!range) {
			const result = await this.duckDb.getSingleDimension(table, columnsSelect, true);
			if (requestId !== this._dataRequestId) return;
			this.timeSeriesChartBuilder.addDimension(result, columnsSelect);
			return;
		}

		const requestedDimensions = this.getRequestedDimensions();
		const data = resampled
			? await this.fetchWindowedOHLC(requestedDimensions, range)
			: await this.duckDb.getWindowedData(
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

	/** Whether `column` is one of the open / high / low / close columns of the active candlesticks. */
	isOHLCColumn(column: string): boolean {
		return this._ohlcMode !== null && Object.values(this._ohlcMode.columns).includes(column);
	}
}
