import type { InjectedMarker } from './injectedMarkers';
import type { InjectedSeries } from './seriesInput';

export type ChartDataValue = number | null;
export type ChartDatasetFormatSimpleObject = Record<string, ChartDataValue[]>;
export type ChartDatasetFormatObject = Record<string, any>[];
export type ChartDatasetFormatArray = number[][];

export type OHLCDimensions = {
	open: string;
	high: string;
	low: string;
	close: string;
};

export type ChartDataset =
	ChartDatasetFormatArray | ChartDatasetFormatObject | ChartDatasetFormatSimpleObject;

export type ChartMarkerPoint = {
	dimName: string;
	timestamp: number;
	name?: string;
};

export type ChartMarkerPointOptions = {
	/**
	 * The marker's shape. Only `'circle' | 'square' | 'arrowUp' | 'arrowDown'` are guaranteed to
	 * render the SAME shape across ECharts, Lightweight Charts and Vela — this is lightweight-charts'
	 * own native marker-shape set (`SeriesMarkerShape`), the narrowest of the three, so it's the
	 * common denominator the others map onto. `'none'` (or omitting `icon`) falls back to a visible
	 * circle on every engine rather than ECharts' own `symbol: 'none'`, which means "draw nothing at
	 * all".
	 *
	 * ECharts additionally accepts its own richer native symbol set (`'rect' | 'roundRect' |
	 * 'triangle' | 'diamond' | 'pin'`) and renders each distinctly — but Lightweight has no
	 * equivalent for any of them and collapses all of them to `'square'`, and Vela to `'circle'`,
	 * so these extras are NOT guaranteed consistent and should only be used where cross-engine
	 * parity doesn't matter.
	 *
	 * Vela draws `'circle'` natively and builds `'square'`, `'arrowUp'` and `'arrowDown'` as
	 * filled polygons. Markers from `setInjectedMarkers` (not Vela) use the same four shapes.
	 *
	 * `shape` is accepted as the same option under the name `InjectedMarker` uses; when both are given
	 * `icon` wins.
	 */
	icon?: string;
	/** Alias of `icon`. */
	shape?: string;
	color?: string;
	position?: string;
	symbolSize?: number;
};

/**
 * What a chart backend can do beyond the primary dataset. Backends report this through
 * `TimeSeriesChartAdapter.capabilities`; a missing flag means "not supported".
 */
export type ChartCapabilities = {
	/** `setInjectedSeries` draws named line series supplied as arrays. */
	injectedSeries?: boolean;
	/** Injected series can be placed in their own panes (`InjectedSeries.pane`). */
	panes?: boolean;
	/** Relative pane heights can be set with `setPaneHeights`. */
	paneHeights?: boolean;
	/** `setInjectedMarkers` draws buy / sell / info markers supplied as an array. */
	injectedMarkers?: boolean;
	/** Markers show their text on hover. */
	markerTooltip?: boolean;
	/** `onCrosshairMove` reports the crosshair position (time, price, pixel point). */
	crosshairEvents?: boolean;
	/** `onVisibleRangeChange` reports the visible time range when it changes. */
	visibleRangeEvents?: boolean;
	/** `setVisibleRange` and `fitContent` move the view to a time range or to all the data. */
	viewport?: boolean;
	/** `getLegendItems` and `onLegendChange` describe the series for an external legend. */
	legend?: boolean;
};

/** A series as an external legend shows it. `toggleLegend(name)` flips `visible`. */
export type LegendItem = {
	name: string;
	/** CSS color of the line. */
	color: string;
	visible: boolean;
};

/** Crosshair position, reported by `onCrosshairMove`. Fields are absent when the cursor leaves the chart. */
export type CrosshairMoveEvent = {
	/** Epoch milliseconds of the bar under the cursor. */
	time?: number;
	/** Value of the first series that has one at that bar (the close of a candle). */
	price?: number;
	/** Cursor position in pixels, relative to the chart's top-left corner. */
	point?: { x: number; y: number };
};

/** Visible time range in epoch milliseconds. */
export type TimeRangeMs = { from: number; to: number };

export interface TimeSeriesChartAdapter {
	/**
	 * Optional feature report. Check it before relying on `setInjectedSeries`,
	 * `setInjectedMarkers` or `setPaneHeights`, which are optional members.
	 */
	readonly capabilities?: ChartCapabilities;
	setLegendIcon(icon: string): this;
	setDataset(data: ChartDataset, yDimensionsNames?: string[]): this;
	setCandlestickSeries(data: ChartDatasetFormatSimpleObject, dims: OHLCDimensions): this;
	build(): this;
	addDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this;
	addMarkerPoint(id: number, data: ChartMarkerPoint, options?: ChartMarkerPointOptions): this;
	getLegendStatus(): Record<string, boolean>;
	toggleLegend(column: string): this;
	getRangeValues(): [number, number];
	goToZoom(start: number, end: number): this;
	scrollToTime(timestamp: number): this;
	getTotalRows(): number;
	toggleMarkers(id: number, dimName: string, shape: string): this;
	clearMarkers(): this;
	getLoadedDimensions?(): string[];
	getActiveDimensions(): string[];
	updateDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this;
	updateDimensions?(data: ChartDatasetFormatSimpleObject, dimNames: string[]): this;
	setDataRange?(start: number, end: number): this;
	/**
	 * Declares the full set of injected series. The adapter diffs it against what is already drawn:
	 * new names are added, missing names are removed, changed ones are updated in place. The chart
	 * is never rebuilt and the visible time range is kept.
	 */
	setInjectedSeries?(series: readonly InjectedSeries[]): this;
	/** Declares the full set of injected markers (same declarative contract as the series). */
	setInjectedMarkers?(markers: readonly InjectedMarker[]): this;
	/**
	 * Relative heights of the panes, keyed by the pane number used in `InjectedSeries.pane`.
	 * Unlisted panes get `1`, the price pane `3`.
	 */
	setPaneHeights?(heights: Readonly<Record<number, number>>): this;
	/**
	 * When `true`, a pane other than the price pane whose series are all hidden shrinks to a
	 * sliver, so a hidden indicator does not leave an empty pane behind. Default `false`.
	 */
	setCollapseEmptyPanes?(collapse: boolean): this;
	/** The line series (primary and injected) for an external legend. Check `capabilities.legend`. */
	getLegendItems?(): LegendItem[];
	/**
	 * Calls `handler` now with the current items and again whenever a series is added, removed or
	 * toggled. Returns the function that removes the handler. Check `capabilities.legend` first.
	 */
	onLegendChange?(handler: (items: LegendItem[]) => void): () => void;
	/**
	 * Calls `handler` on every crosshair move. Returns the function that removes the handler. Check
	 * `capabilities.crosshairEvents` first.
	 */
	onCrosshairMove?(handler: (event: CrosshairMoveEvent) => void): () => void;
	/**
	 * Calls `handler` when the visible time range changes. Returns the function that removes the
	 * handler. Check `capabilities.visibleRangeEvents` first.
	 */
	onVisibleRangeChange?(handler: (range: TimeRangeMs) => void): () => void;
	/** Shows the time range `[fromMs, toMs]` (epoch milliseconds). Check `capabilities.viewport` first. */
	setVisibleRange?(fromMs: number, toMs: number): this;
	/** Shows all the data. Check `capabilities.viewport` first. */
	fitContent?(): this;
}
