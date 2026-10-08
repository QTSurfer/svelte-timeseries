import {
	LineSeries,
	CandlestickSeries,
	createSeriesMarkers,
	type IChartApi,
	type ISeriesApi,
	type ISeriesMarkersPluginApi,
	type LineData,
	type WhitespaceData,
	type CandlestickData,
	type SeriesMarkerBarPosition,
	type SeriesMarker,
	type SeriesMarkerShape,
	type MouseEventParams,
	type SeriesType,
	type Time,
	type UTCTimestamp
} from 'lightweight-charts';
import type {
	ChartCapabilities,
	ChartDataset,
	ChartDataValue,
	ChartDatasetFormatArray,
	ChartDatasetFormatObject,
	ChartDatasetFormatSimpleObject,
	ChartMarkerPointOptions,
	OHLCDimensions,
	TimeSeriesChartAdapter
} from './chartAdapter';
import { registerChartHoverHooks } from './chartHooks';
import {
	findGroupsInSpan,
	groupMarkers,
	normalizeInjectedMarkers,
	toHoverItems,
	type InjectedMarker,
	type MarkerGroup,
	type MarkerHover,
	type NormalizedMarker
} from './injectedMarkers';
import { getPricePrecision, getSignificantPrecision } from './pricePrecision';
import {
	defaultInjectedColor,
	diffInjectedSeries,
	lineStyleToLightweight,
	lineWidthToLightweight,
	normalizePane,
	resolvePaneIndexes,
	resolvePaneRatios,
	snapshotInjectedSeries,
	toLightweightLineData,
	toSortedColumns,
	type InjectedSeries,
	type InjectedSeriesChange,
	type InjectedSeriesSnapshot
} from './seriesInput';
export { getPricePrecision, formatPreciseValue } from './pricePrecision';

type ConfigBuilder = {
	externalManagerLegend?: boolean;
};

type MarkerState = {
	id: number;
	time: Time;
	timeMs: number;
	color: string;
	shape: SeriesMarkerShape;
	position: SeriesMarkerBarPosition;
	text?: string;
	visible: boolean;
	size?: number;
};

/** Where the view was before a change: see `captureView`. */
type ViewAnchor = { from: Time; index: number; logicalFrom: number; width: number };

type InjectedEntry = {
	api: ISeriesApi<'Line', Time>;
	/** Color used while the app does not set one. */
	autoColor: string;
	/** Pane number requested by the app (not the chart's pane index). */
	pane: number;
	precision: number;
	plugin?: ISeriesMarkersPluginApi<Time>;
};

const SERIES_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];
/** Marker host key of the candlestick series (not a possible column name). */
const CANDLESTICK_HOST = '\u0000candlestick';
const INJECTED_PREFIX = '\u0000injected:';
const injectedHost = (name: string) => `${INJECTED_PREFIX}${name}`;
/** `MismatchDirection` values of `ISeriesApi.dataByIndex`, spelled as numbers so the enum is not imported. */
const NEAREST_LEFT = -1;
const NEAREST_RIGHT = 1;

export class LightweightTimeSeriesChartBuilder implements TimeSeriesChartAdapter {
	public LightweightChart: IChartApi;
	private builderConfig: ConfigBuilder = {
		externalManagerLegend: false
	};
	private dataset: ChartDatasetFormatSimpleObject = {};
	private yDimensions: string[] = [];
	private yDimensionNames: string[] = [];
	private _tsColumn = '_ts';
	private selected: Record<string, boolean> = {};
	private series = new Map<string, ISeriesApi<'Line', Time>>();
	private pricePrecisions = new Map<string, number>();
	private candlestickPrecision: number | null = null;
	private _candlestickSeries: ISeriesApi<'Candlestick', Time> | null = null;
	private _ohlcDims: OHLCDimensions | null = null;
	private markersPlugins = new Map<string, ISeriesMarkersPluginApi<Time>>();
	private markers = new Map<string, MarkerState[]>();
	private _dataDirty = false;
	private _building = false;
	private _timeRangeForced = false;
	private candlestickPlugin: ISeriesMarkersPluginApi<Time> | null = null;
	private injected = new Map<string, InjectedEntry>();
	private injectedApplied = new Map<string, InjectedSeriesSnapshot>();
	private injectedColorCount = 0;
	private injectedMarkers: NormalizedMarker[] = [];
	private markerGroups = new Map<string, MarkerGroup[]>();
	private paneHeights: Readonly<Record<number, number>> | undefined;
	private appliedPaneLayout = '';
	private reportedIssues = new Set<string>();

	readonly capabilities: ChartCapabilities = {
		injectedSeries: true,
		panes: true,
		paneHeights: true,
		injectedMarkers: true,
		markerTooltip: true
	};

	constructor(instance: IChartApi, builderConfig?: ConfigBuilder) {
		this.LightweightChart = instance;
		this.builderConfig = { ...this.builderConfig, ...builderConfig };
		registerChartHoverHooks(instance, {
			getMarkerHover: (param) => this.getMarkerHover(param),
			formatValue: (series, value) => this.formatInjectedValue(series, value)
		});
	}

	setLegendIcon(_icon: string): this {
		return this;
	}

	setDataset(data: ChartDataset, yDimensionsNames?: string[]): this {
		const normalized = this.normalizeDataset(data, yDimensionsNames);

		this.clearSeries();
		this.dataset = normalized.dataset;
		this.yDimensions = normalized.yDimensions;
		this.yDimensionNames = normalized.yDimensionNames;
		this._tsColumn = normalized.tsColumn;
		this.selected = {};
		this._dataDirty = true;

		this.createSeriesData();
		this.build();
		this.reconcileInjectedPanes();
		return this;
	}

	setCandlestickSeries(data: ChartDatasetFormatSimpleObject, dims: OHLCDimensions): this {
		this._tsColumn = Object.keys(data)[0];
		this.dataset = data;
		this.yDimensions = [dims.open, dims.high, dims.low, dims.close];
		this.yDimensionNames = [...this.yDimensions];
		this._ohlcDims = dims;

		// Remove existing candlestick series before recreating
		if (this._candlestickSeries) {
			this.candlestickPlugin?.detach();
			this.candlestickPlugin = null;
			this.LightweightChart.removeSeries(this._candlestickSeries);
			this._candlestickSeries = null;
		}

		this._candlestickSeries = this.LightweightChart.addSeries(CandlestickSeries, {
			upColor: '#26a69a',
			downColor: '#ef5350',
			borderVisible: false,
			wickUpColor: '#26a69a',
			wickDownColor: '#ef5350',
			priceFormat: this.getCandlestickPriceFormat(dims)
		});
		this.candlestickPrecision = this.getCandlestickPrecision(dims);

		this.selected['Candlestick'] = true;

		const candleData = this.toCandlestickData(dims);
		this._candlestickSeries.setData(candleData);

		this.LightweightChart.timeScale().fitContent();
		// Markers added for the OHLC columns (or by injected input) belong on the new series.
		this.syncAllMarkerHosts();
		this.reconcileInjectedPanes();
		return this;
	}

	addDimension(data: ChartDatasetFormatSimpleObject, dimName: string) {
		if (!this.dataset[this._tsColumn]?.length) {
			throw new Error('No source data or dimensions found. Before loading data');
		}

		this.dataset[dimName] = data[dimName];
		this.yDimensions.push(dimName);
		this.yDimensionNames.push(dimName);
		this._dataDirty = true;
		this.addSeries(dimName, dimName, true);

		return this.build();
	}

	addMarkerPoint(
		id: number,
		data: {
			dimName: string;
			timestamp: number;
			name?: string;
		},
		options?: ChartMarkerPointOptions
	): this {
		const markerState: MarkerState = {
			id,
			time: this.toChartTime(data.timestamp),
			timeMs: data.timestamp,
			color: options?.color ?? '#000000',
			shape: this.mapMarkerShape(options?.icon),
			position: this.mapMarkerPosition(options?.position),
			text: data.name,
			visible: true,
			size: options?.symbolSize ?? 4
		};

		const markers = this.markers.get(data.dimName) ?? [];
		markers.push(markerState);
		this.markers.set(data.dimName, markers);
		this.syncSeriesMarkers(data.dimName);
		return this;
	}

	build() {
		if (this._building) {
			return this;
		}
		this._building = true;

		const visibleLogicalRange = this.LightweightChart.timeScale().getVisibleLogicalRange();
		const rebuildData = this._dataDirty;
		this._dataDirty = false;

		if (rebuildData) {
			if (this._candlestickSeries && this._ohlcDims) {
				const precision = this.getCandlestickPrecision(this._ohlcDims);
				if (precision !== this.candlestickPrecision) {
					this._candlestickSeries.applyOptions({
						priceFormat: this.getCandlestickPriceFormat(this._ohlcDims)
					});
					this.candlestickPrecision = precision;
				}
				this._candlestickSeries.setData(this.toCandlestickData(this._ohlcDims));
			}

			for (const dim of this.yDimensions) {
				const series = this.series.get(dim);
				if (!series) {
					continue;
				}
				const lineData = this.toLineData(dim);
				const precision = getPricePrecision(this.dataset[dim] ?? []);
				if (precision !== this.pricePrecisions.get(dim)) {
					series.applyOptions({
						priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
					});
					this.pricePrecisions.set(dim, precision);
				}
				series.setData(lineData);
				series.applyOptions({ visible: this.selected[dim] ?? false });
			}

			if (visibleLogicalRange) {
				this.LightweightChart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
			} else {
				this.LightweightChart.timeScale().fitContent();
				this.forceTimeRangeToDataset();
			}
		}

		this.syncAllMarkerHosts();

		this._building = false;
		return this;
	}

	getLegendStatus() {
		return this.selected;
	}

	toggleLegend(column: string): this {
		const injected = column && !this.series.has(column) ? this.injected.get(column) : undefined;
		if (injected) {
			injected.api.applyOptions({ visible: !injected.api.options().visible });
			return this;
		}
		if (!column || !this.series.has(column)) {
			return this;
		}

		const nextVisible = !(this.selected[column] ?? false);
		this.selected[column] = nextVisible;
		this.series.get(column)?.applyOptions({ visible: nextVisible });
		return this;
	}

	goToZoom(start: number, end: number): this {
		const [min, max] = this.getRangeValues();
		if (!min && !max) {
			return this;
		}

		if (start <= 0 && end >= 100) {
			this.LightweightChart.timeScale().fitContent();
			return this;
		}

		const width = max - min;
		const from = min + width * (start / 100);
		const to = min + width * (end / 100);

		this.LightweightChart.timeScale().setVisibleRange({
			from: this.toChartTime(from),
			to: this.toChartTime(to)
		});

		return this;
	}

	scrollToTime(timestamp: number): this {
		const timeSec = this.toChartTime(timestamp);
		const timeScale = this.LightweightChart.timeScale();
		const visibleRange = timeScale.getVisibleRange();

		if (!visibleRange) {
			timeScale.setVisibleRange({ from: timeSec, to: (timeSec + 60) as Time });
			return this;
		}

		const width = Number(visibleRange.to) - Number(visibleRange.from);
		const halfWidth = Math.max(width / 2, 30);

		timeScale.setVisibleRange({
			from: (timeSec - halfWidth) as Time,
			to: (timeSec + halfWidth) as Time
		});

		return this;
	}

	getTotalRows() {
		return this.dataset[this._tsColumn]?.length ?? 0;
	}

	getLoadedDimensions(): string[] {
		return [...this.yDimensions];
	}

	getActiveDimensions(): string[] {
		return this.getLoadedDimensions();
	}

	updateDimension(data: ChartDatasetFormatSimpleObject, dimName: string) {
		return this.updateDimensions(data, [dimName]);
	}

	updateDimensions(data: ChartDatasetFormatSimpleObject, dimNames: string[]) {
		if (data[this._tsColumn]) {
			this.dataset[this._tsColumn] = data[this._tsColumn];
		}
		for (const dimName of dimNames) {
			if (data[dimName]) {
				this.dataset[dimName] = data[dimName];
			}
		}
		this._dataDirty = true;
		return this.build();
	}

	getRangeValues(): [number, number] {
		const timestamps = (this.dataset[this._tsColumn] ?? []).filter(
			(timestamp): timestamp is number => timestamp !== null
		);
		if (!timestamps.length) {
			return [0, 0];
		}
		return [timestamps[0], timestamps[timestamps.length - 1]];
	}

	toggleMarkers(id: number, dimName: string, shape: string) {
		const markers = this.markers.get(dimName);
		if (!markers) {
			return this;
		}

		const marker = markers.find((item) => item.id === id);
		if (!marker) {
			return this;
		}

		marker.visible = !marker.visible;
		if (marker.visible) {
			marker.shape = this.mapMarkerShape(shape);
		}
		this.syncSeriesMarkers(dimName);
		return this;
	}

	/** Clears the markers added with `addMarkerPoint`. Injected markers follow `setInjectedMarkers`. */
	clearMarkers(): this {
		this.markers.clear();
		this.syncAllMarkerHosts();
		return this;
	}

	/**
	 * Declares the named line series supplied by the host app (indicators, for instance).
	 *
	 * The call is declarative and incremental: series are matched by name against what is already
	 * drawn, so new names are added, missing names are removed and changed ones are updated in
	 * place. The chart is never rebuilt and the visible time range is kept. Panes follow
	 * `InjectedSeries.pane`; `0` is the price pane. See {@link InjectedSeries}.
	 *
	 * Call it after the primary dataset is set (`setDataset` / `setCandlestickSeries`).
	 */
	setInjectedSeries(input: readonly InjectedSeries[]): this {
		const diff = diffInjectedSeries(this.injectedApplied, input);
		this.reportIssues(diff.issues);
		if (!diff.removed.length && !diff.added.length && !diff.changed.length) {
			return this;
		}

		const view = this.captureView();

		for (const name of diff.removed) {
			this.removeInjected(name);
		}

		const requestedPanes = new Map(
			diff.valid.map((series) => [series.name, normalizePane(series.pane)] as const)
		);
		const targets = resolvePaneIndexes(requestedPanes, this.hasPricePane());
		for (const series of diff.added) {
			this.addInjected(series, targets.get(series.name) ?? 0);
		}
		for (const change of diff.changed) {
			this.updateInjected(change);
		}
		for (const series of diff.valid) {
			this.injectedApplied.set(series.name, snapshotInjectedSeries(series));
		}

		this.reconcileInjectedPanes();
		this.syncAllMarkerHosts();
		this.restoreView(view);
		return this;
	}

	/**
	 * Declares the markers supplied by the host app. Markers attach to the price series, or to the
	 * injected series named in `InjectedMarker.series`; one that names a series which does not
	 * exist yet waits for it. Markers in the same UTC second that look alike are merged into one
	 * glyph with a count and all of them are listed in the hover tooltip.
	 */
	setInjectedMarkers(input: readonly InjectedMarker[]): this {
		const { markers, issues } = normalizeInjectedMarkers(input);
		this.reportIssues(issues);
		this.injectedMarkers = markers;
		this.syncAllMarkerHosts();
		return this;
	}

	/** Relative pane heights keyed by pane number (see `InjectedSeries.pane`). */
	setPaneHeights(heights: Readonly<Record<number, number>>): this {
		this.paneHeights = heights;
		this.appliedPaneLayout = '';
		this.reconcileInjectedPanes();
		return this;
	}

	private addInjected(series: InjectedSeries, paneIndex: number) {
		const columns = toSortedColumns(series.times, series.values);
		const autoColor = defaultInjectedColor(this.injectedColorCount++);
		const precision = getSignificantPrecision(columns.values);

		const api = this.LightweightChart.addSeries(
			LineSeries,
			{
				color: series.color ?? autoColor,
				lineWidth: lineWidthToLightweight(series.lineWidth),
				lineStyle: lineStyleToLightweight(series.lineStyle),
				title: series.name,
				priceScaleId: 'right',
				visible: series.visible ?? true,
				crosshairMarkerVisible: false,
				lastValueVisible: true,
				priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
			},
			paneIndex
		);
		api.setData(toLightweightLineData(columns));
		this.injected.set(series.name, {
			api,
			autoColor,
			pane: normalizePane(series.pane),
			precision
		});
	}

	private updateInjected(change: InjectedSeriesChange) {
		const { series } = change;
		const entry = this.injected.get(series.name);
		if (!entry) {
			return;
		}

		if (change.data) {
			const columns = toSortedColumns(series.times, series.values);
			const precision = getSignificantPrecision(columns.values);
			if (precision !== entry.precision) {
				entry.api.applyOptions({
					priceFormat: { type: 'price', precision, minMove: 10 ** -precision }
				});
				entry.precision = precision;
			}
			entry.api.setData(toLightweightLineData(columns));
		}
		if (change.style) {
			entry.api.applyOptions({
				color: series.color ?? entry.autoColor,
				lineWidth: lineWidthToLightweight(series.lineWidth),
				lineStyle: lineStyleToLightweight(series.lineStyle)
			});
		}
		if (change.visible) {
			entry.api.applyOptions({ visible: series.visible ?? true });
		}
		if (change.pane) {
			entry.pane = normalizePane(series.pane);
		}
	}

	private removeInjected(name: string) {
		const entry = this.injected.get(name);
		if (!entry) {
			return;
		}
		entry.plugin?.detach();
		this.LightweightChart.removeSeries(entry.api);
		this.injected.delete(name);
		this.injectedApplied.delete(name);
	}

	private hasPricePane(): boolean {
		return this.series.size > 0 || this._candlestickSeries !== null;
	}

	/**
	 * Moves injected series to the panes their `pane` numbers resolve to and applies the pane
	 * heights. Safe to call at any time; it does nothing without injected series.
	 */
	private reconcileInjectedPanes() {
		if (this.injected.size === 0) {
			this.appliedPaneLayout = '';
			return;
		}

		const requested = new Map(
			[...this.injected].map(([name, entry]) => [name, entry.pane] as const)
		);
		const hasPrice = this.hasPricePane();
		const targets = [...resolvePaneIndexes(requested, hasPrice)].sort((a, b) => a[1] - b[1]);

		// Moving a series can drop an emptied pane and shift the indexes after it, so repeat until
		// every series sits where it should (bounded: each pass fixes at least one series).
		for (let pass = 0; pass <= targets.length; pass++) {
			let moved = false;
			for (const [name, index] of targets) {
				const api = this.injected.get(name)?.api;
				if (api && api.getPane().paneIndex() !== index) {
					api.moveToPane(index);
					moved = true;
				}
			}
			if (!moved) break;
		}

		const panes = this.LightweightChart.panes();
		if (panes.length < 2) {
			this.appliedPaneLayout = '';
			return;
		}

		// An emptied price pane must not be removed: it would shift every other pane up.
		panes[0].setPreserveEmptyPane(true);

		const ratios = resolvePaneRatios(this.paneHeights, requested.values(), hasPrice);
		const layout = ratios.join(',');
		if (ratios.length === panes.length && layout !== this.appliedPaneLayout) {
			ratios.forEach((ratio, index) => panes[index].setStretchFactor(ratio));
			this.appliedPaneLayout = layout;
		}
	}

	/**
	 * Remembers where the view is: the bar at its left edge as a position on the time scale, and the
	 * logical range. Positions come from the scale's points, which are updated synchronously when
	 * data is set, not from the visible time range, which lags behind range changes that are still
	 * waiting for the next frame.
	 */
	private captureView(): ViewAnchor | null {
		const timeScale = this.LightweightChart.timeScale();
		const range = timeScale.getVisibleRange();
		const logical = timeScale.getVisibleLogicalRange();
		const index = range ? timeScale.timeToIndex(range.from, true) : null;
		if (!range || !logical || index === null) {
			return null;
		}
		return { from: range.from, index, logicalFrom: logical.from, width: logical.to - logical.from };
	}

	/**
	 * Adding a series whose times reach before or after the current ones changes the points of the
	 * time scale, and the chart then moves the view by its own rule (it keeps the distance to the
	 * last bar), which would shift it in time. Puts the view back on the same bars. Does nothing
	 * when the scale did not change, which is the usual case.
	 */
	private restoreView(before: ViewAnchor | null) {
		const timeScale = this.LightweightChart.timeScale();
		if (!before) {
			// First data on an empty chart with no price series to define the view: show all of it.
			if (!this.hasPricePane()) timeScale.fitContent();
			return;
		}

		const index = timeScale.timeToIndex(before.from, true);
		const logical = timeScale.getVisibleLogicalRange();
		if (index === null || !logical) {
			return;
		}
		const anchorShift = index - before.index;
		const chartShift = logical.from - before.logicalFrom;
		if (anchorShift === chartShift) {
			return;
		}
		const from = before.logicalFrom + anchorShift;
		timeScale.setVisibleLogicalRange({ from, to: from + before.width });
	}

	/**
	 * Markers drawn on the bar under the crosshair, across every series that has markers. A marker
	 * belongs to the bar of its series that is at or just before its time (where the chart draws
	 * it), so the hit test is a binary search on the sorted markers and costs nothing per move.
	 */
	private getMarkerHover(param: MouseEventParams<Time>): MarkerHover | null {
		if (this.markerGroups.size === 0 || param.logical === undefined) {
			return null;
		}
		const logical = Math.round(param.logical);

		const hits: MarkerGroup[] = [];
		for (const [hostKey, groups] of this.markerGroups) {
			const host = this.getHostSeries(hostKey);
			if (!host || !host.options().visible) continue;

			const bar = host.dataByIndex(logical, NEAREST_LEFT);
			if (!bar) continue;
			const next = host.dataByIndex(logical + 1, NEAREST_RIGHT);
			const from = bar.time as number;
			const to = next ? (next.time as number) : Number.POSITIVE_INFINITY;
			hits.push(...findGroupsInSpan(groups, from, to));
		}

		if (hits.length === 0) {
			return null;
		}
		hits.sort((a, b) => a.second - b.second);
		return toHoverItems(hits);
	}

	private formatInjectedValue(series: ISeriesApi<SeriesType, Time>, value: number) {
		for (const entry of this.injected.values()) {
			if (entry.api === series) {
				return entry.api.priceFormatter().format(value);
			}
		}
		return undefined;
	}

	private reportIssues(issues: readonly string[]) {
		for (const issue of issues) {
			if (this.reportedIssues.has(issue)) continue;
			this.reportedIssues.add(issue);
			console.warn(`[sveltecharts] ${issue}`);
		}
	}

	private normalizeDataset(data: ChartDataset, yDimensionsNames?: string[]) {
		if (Array.isArray(data)) {
			if (!data.length || Array.isArray(data[0])) {
				return this.normalizeMatrix(data as ChartDatasetFormatArray, yDimensionsNames);
			}
			return this.normalizeObjectArray(data as ChartDatasetFormatObject, yDimensionsNames);
		}

		return this.normalizeSimpleObject(data, yDimensionsNames);
	}

	private normalizeSimpleObject(data: ChartDatasetFormatSimpleObject, yDimensionsNames?: string[]) {
		const keys = Object.keys(data);
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		if (yDimensionsNames?.length && yDimensionsNames.length !== keys.length + 1) {
			throw new Error(
				`Dimensions length ${yDimensionsNames.length} does not match total columns ${keys.length + 1}.`
			);
		}

		return {
			tsColumn,
			dataset: data,
			yDimensions: keys,
			yDimensionNames: yDimensionsNames?.length ? yDimensionsNames.slice(1) : keys
		};
	}

	private normalizeObjectArray(data: ChartDatasetFormatObject, yDimensionsNames?: string[]) {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		const keys = Object.keys(data[0]);
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		const dataset: ChartDatasetFormatSimpleObject = {
			[tsColumn]: data.map((row) => this.normalizeDataValue(row[tsColumn]))
		};

		for (const key of keys) {
			dataset[key] = data.map((row) => this.normalizeDataValue(row[key]));
		}

		return {
			tsColumn,
			dataset,
			yDimensions: keys,
			yDimensionNames: yDimensionsNames?.length ? yDimensionsNames.slice(1) : keys
		};
	}

	private normalizeMatrix(data: ChartDatasetFormatArray, yDimensionsNames?: string[]) {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		if (!yDimensionsNames?.length) {
			throw new Error('Requires yDimensionsNames. e.g. ["v1", "v2", "v3"]');
		}

		const keys = [...yDimensionsNames];
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		const totalCol = data[0]?.length ?? 0;
		if (totalCol !== yDimensionsNames.length) {
			throw new Error(
				`Dimensions length ${yDimensionsNames.length} does not match total columns ${totalCol}.`
			);
		}

		const dataset: ChartDatasetFormatSimpleObject = {
			[tsColumn]: data.map((row) => Number(row[0]))
		};

		keys.forEach((key, index) => {
			dataset[key] = data.map((row) => Number(row[index + 1]));
		});

		return {
			tsColumn,
			dataset,
			yDimensions: keys,
			yDimensionNames: keys
		};
	}

	private createSeriesData() {
		if (!this.yDimensions.length || !this.yDimensionNames.length) {
			throw new Error('No dimensions found.');
		}

		if (this.yDimensions.length !== this.yDimensionNames.length) {
			throw new Error(
				`Dimensions length ${this.yDimensionNames.length} does not match total columns ${this.yDimensions.length}.`
			);
		}

		this.syncPriceScales();
		this.yDimensions.forEach((dim, index) => {
			const isSelected =
				(this.yDimensions.length > 1 && dim === 'price') || this.yDimensions.length === 1;
			this.addSeries(dim, this.yDimensionNames[index], isSelected, index);
		});
	}

	private addSeries(dim: string, dimName: string, isSelected: boolean, index?: number) {
		const pricePrecision = getPricePrecision(this.dataset[dim] ?? []);

		const series = this.LightweightChart.addSeries(LineSeries, {
			color: SERIES_COLORS[(index ?? this.series.size) % SERIES_COLORS.length],
			lineWidth: 1,
			title: dimName,
			priceScaleId: this.isPercentageDimension(dim) ? 'left' : 'right',
			visible: isSelected,
			crosshairMarkerVisible: false,
			lastValueVisible: true,
			priceFormat: {
				type: 'price',
				precision: pricePrecision,
				minMove: 10 ** -pricePrecision
			}
		});

		this.series.set(dim, series);
		this.pricePrecisions.set(dim, pricePrecision);
		this.selected[dim] = isSelected;
		this.markersPlugins.set(dim, createSeriesMarkers(series, []));
	}

	private syncSeriesMarkers(dimName: string) {
		this.syncHostMarkers(this.legacyHost(dimName));
	}

	/** Series a marker column name refers to. OHLC column names resolve to the candlestick series. */
	private legacyHost(dimName: string): string {
		if (this.series.has(dimName)) {
			return dimName;
		}
		if (
			this._candlestickSeries &&
			(dimName === 'Candlestick' ||
				(this._ohlcDims !== null && Object.values(this._ohlcDims).includes(dimName)))
		) {
			return CANDLESTICK_HOST;
		}
		return dimName;
	}

	/** The series injected markers attach to when they do not name one: the price series. */
	private primaryHost(): string | undefined {
		if (this._candlestickSeries) {
			return CANDLESTICK_HOST;
		}
		const firstDimension = this.series.keys().next();
		if (!firstDimension.done) {
			return firstDimension.value;
		}
		const firstInjected = this.injected.keys().next();
		return firstInjected.done ? undefined : injectedHost(firstInjected.value);
	}

	private injectedMarkerHost(series: string | undefined): string | undefined {
		if (series === undefined) {
			return this.primaryHost();
		}
		if (this.injected.has(series)) {
			return injectedHost(series);
		}
		return this.series.has(series) ? series : undefined;
	}

	private getHostSeries(hostKey: string): ISeriesApi<'Line' | 'Candlestick', Time> | undefined {
		if (hostKey === CANDLESTICK_HOST) {
			return this._candlestickSeries ?? undefined;
		}
		if (hostKey.startsWith(INJECTED_PREFIX)) {
			return this.injected.get(hostKey.slice(INJECTED_PREFIX.length))?.api;
		}
		return this.series.get(hostKey);
	}

	private getHostPlugin(hostKey: string): ISeriesMarkersPluginApi<Time> | undefined {
		if (hostKey === CANDLESTICK_HOST) {
			return this.candlestickPlugin ?? undefined;
		}
		if (hostKey.startsWith(INJECTED_PREFIX)) {
			return this.injected.get(hostKey.slice(INJECTED_PREFIX.length))?.plugin;
		}
		return this.markersPlugins.get(hostKey);
	}

	private ensureHostPlugin(hostKey: string): ISeriesMarkersPluginApi<Time> | undefined {
		const existing = this.getHostPlugin(hostKey);
		if (existing) {
			return existing;
		}
		const series = this.getHostSeries(hostKey);
		if (!series) {
			return undefined;
		}
		const plugin = createSeriesMarkers(series, []);
		if (hostKey === CANDLESTICK_HOST) {
			this.candlestickPlugin = plugin;
		} else if (hostKey.startsWith(INJECTED_PREFIX)) {
			const entry = this.injected.get(hostKey.slice(INJECTED_PREFIX.length));
			if (entry) entry.plugin = plugin;
		} else {
			this.markersPlugins.set(hostKey, plugin);
		}
		return plugin;
	}

	private syncAllMarkerHosts() {
		const hosts = new Set<string>(this.series.keys());
		if (this._candlestickSeries) {
			hosts.add(CANDLESTICK_HOST);
		}
		for (const name of this.injected.keys()) {
			hosts.add(injectedHost(name));
		}
		for (const dimName of this.markers.keys()) {
			hosts.add(this.legacyHost(dimName));
		}

		this.markerGroups.clear();
		for (const host of hosts) {
			this.syncHostMarkers(host);
		}
	}

	/**
	 * Redraws the markers of one series from every source (JSON column markers and injected
	 * markers). Markers that share a UTC second and look are merged into one glyph with a count and
	 * markers that look different are stacked by the chart, so none is dropped (see `groupMarkers`).
	 */
	private syncHostMarkers(hostKey: string) {
		const own: NormalizedMarker[] = [];
		for (const [dimName, list] of this.markers) {
			if (this.legacyHost(dimName) !== hostKey) continue;
			for (const marker of list) {
				if (marker.visible) own.push(this.toNormalizedMarker(marker));
			}
		}
		const injected = this.injectedMarkers.filter(
			(marker) => this.injectedMarkerHost(marker.series) === hostKey
		);

		const groups = groupMarkers([...own, ...injected]);
		if (groups.length > 0) {
			this.markerGroups.set(hostKey, groups);
		} else {
			this.markerGroups.delete(hostKey);
		}

		const plugin = groups.length > 0 ? this.ensureHostPlugin(hostKey) : this.getHostPlugin(hostKey);
		if (!plugin) {
			return;
		}
		plugin.setMarkers(groups.map((group) => this.toChartMarker(group)));

		if (own.length > 0) {
			this.expandTimeRangeForMarkers();
		}
	}

	private toNormalizedMarker(marker: MarkerState): NormalizedMarker {
		return {
			timeMs: marker.timeMs,
			second: marker.time as number,
			kind: undefined,
			kindLabel: 'Marker',
			position: marker.position,
			shape: marker.shape,
			color: marker.color || '#888888',
			text: marker.text,
			chartText: marker.text,
			size: marker.size
		};
	}

	private toChartMarker(group: MarkerGroup): SeriesMarker<Time> {
		return {
			time: group.second as UTCTimestamp,
			color: group.color,
			shape: group.shape,
			position: group.position,
			...(group.price !== undefined ? { price: group.price } : {}),
			...(group.size !== undefined ? { size: group.size } : {}),
			...(group.label ? { text: group.label } : {})
		} as SeriesMarker<Time>;
	}

	private expandTimeRangeForMarkers() {
		const timeScale = this.LightweightChart.timeScale();
		const visibleRange = timeScale.getVisibleRange();

		if (!visibleRange) {
			return;
		}

		let minTime = visibleRange.from as number;
		let maxTime = visibleRange.to as number;

		for (const [, markerList] of this.markers) {
			for (const m of markerList) {
				const t = m.time as number;
				if (t < minTime) minTime = t;
				if (t > maxTime) maxTime = t;
			}
		}

		if (minTime < (visibleRange.from as number) || maxTime > (visibleRange.to as number)) {
			const padding = (maxTime - minTime) * 0.1;
			timeScale.setVisibleRange({
				from: (minTime - padding) as Time,
				to: (maxTime + padding) as Time
			});
		}
	}

	private clearSeries() {
		for (const plugin of this.markersPlugins.values()) {
			plugin.detach();
		}
		this.candlestickPlugin?.detach();
		this.candlestickPlugin = null;

		for (const series of this.series.values()) {
			this.LightweightChart.removeSeries(series);
		}

		if (this._candlestickSeries) {
			this.LightweightChart.removeSeries(this._candlestickSeries);
			this._candlestickSeries = null;
			this._ohlcDims = null;
		}

		this.series.clear();
		this.pricePrecisions.clear();
		this.candlestickPrecision = null;
		this.markersPlugins.clear();
		this.markers.clear();
		this.markerGroups.clear();
		this._timeRangeForced = false;
		this._building = false;
	}

	private toCandlestickData(dims: OHLCDimensions): CandlestickData<Time>[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const opens = this.dataset[dims.open] ?? [];
		const highs = this.dataset[dims.high] ?? [];
		const lows = this.dataset[dims.low] ?? [];
		const closes = this.dataset[dims.close] ?? [];

		const seen = new Set<number>();
		const result: CandlestickData<Time>[] = [];

		for (let i = 0; i < timestamps.length; i++) {
			const timestamp = timestamps[i];
			const open = opens[i];
			const high = highs[i];
			const low = lows[i];
			const close = closes[i];
			if (timestamp == null || open == null || high == null || low == null || close == null) {
				continue;
			}
			const t = this.toChartTime(timestamp);
			const tNum = t as number;
			if (seen.has(tNum)) continue;
			seen.add(tNum);
			result.push({ time: t, open, high, low, close });
		}

		return result;
	}

	private getCandlestickPrecision(dims: OHLCDimensions): number {
		return Math.max(
			getPricePrecision(this.dataset[dims.open] ?? []),
			getPricePrecision(this.dataset[dims.high] ?? []),
			getPricePrecision(this.dataset[dims.low] ?? []),
			getPricePrecision(this.dataset[dims.close] ?? [])
		);
	}

	private getCandlestickPriceFormat(dims: OHLCDimensions) {
		const precision = this.getCandlestickPrecision(dims);
		return { type: 'price' as const, precision, minMove: 10 ** -precision };
	}

	private toLineData(dim: string): Array<LineData<Time> | WhitespaceData<Time>> {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dim] ?? [];

		if (timestamps.length === 0) {
			return [];
		}

		const seen = new Set<number>();
		const result: Array<LineData<Time> | WhitespaceData<Time>> = [];

		for (let i = 0; i < timestamps.length; i++) {
			const timestamp = timestamps[i];
			if (timestamp == null) continue;
			const t = this.toChartTime(timestamp);
			const tNum = t as number;
			if (seen.has(tNum)) continue;
			seen.add(tNum);
			const value = values[i];
			result.push(value == null ? { time: t } : { time: t, value });
		}

		return result;
	}

	private toChartTime(timestamp: number): UTCTimestamp {
		return Math.floor(timestamp / 1000) as UTCTimestamp;
	}

	private forceTimeRangeToDataset() {
		if (this._timeRangeForced) {
			return;
		}
		this._timeRangeForced = true;

		const timestamps = (this.dataset[this._tsColumn] ?? []).filter(
			(timestamp): timestamp is number => timestamp !== null
		);
		if (timestamps.length === 0) {
			return;
		}

		let minMs = timestamps[0];
		let maxMs = timestamps[0];
		for (let i = 1; i < timestamps.length; i++) {
			const t = timestamps[i];
			if (t < minMs) minMs = t;
			if (t > maxMs) maxMs = t;
		}

		const minSec = this.toChartTime(minMs);
		const maxSec = this.toChartTime(maxMs);

		this.LightweightChart.timeScale().setVisibleRange({
			from: minSec,
			to: maxSec
		});
	}

	private isPercentageDimension(dim: string) {
		return !dim.startsWith('_') && dim.endsWith('%');
	}

	private normalizeDataValue(value: unknown): ChartDataValue {
		return value == null ? null : Number(value);
	}

	private syncPriceScales() {
		const hasPercentageSeries = this.yDimensions.some((dim) => this.isPercentageDimension(dim));
		const hasValueSeries = this.yDimensions.some((dim) => !this.isPercentageDimension(dim));

		this.LightweightChart.applyOptions({
			leftPriceScale: {
				visible: hasPercentageSeries
			},
			rightPriceScale: {
				visible: hasValueSeries
			}
		});
	}

	private mapMarkerShape(shape?: string): SeriesMarkerShape {
		if (shape === 'circle' || shape === 'arrowUp' || shape === 'arrowDown') {
			return shape;
		}

		if (shape === 'none') {
			return 'circle';
		}

		return 'square';
	}

	private mapMarkerPosition(position?: string): SeriesMarkerBarPosition {
		if (position === 'inside') {
			return 'inBar';
		}

		if (position === 'aboveBar' || position === 'belowBar' || position === 'inBar') {
			return position;
		}

		return 'aboveBar';
	}
}
