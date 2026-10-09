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
	| ChartDatasetFormatArray
	| ChartDatasetFormatObject
	| ChartDatasetFormatSimpleObject;

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
	 */
	icon?: string;
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
};

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
}
