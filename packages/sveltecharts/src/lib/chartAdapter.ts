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
	 * render the SAME shape across ECharts and Lightweight Charts — this is lightweight-charts'
	 * own native marker-shape set (`SeriesMarkerShape`), the narrower of the two, so it's the
	 * common denominator ECharts maps onto. `'none'` (or omitting `icon`) falls back to a
	 * visible default per engine (ECharts/Lightweight: circle) rather than ECharts' own
	 * `symbol: 'none'`, which means "draw nothing at all".
	 *
	 * ECharts additionally accepts its own richer native symbol set (`'rect' | 'roundRect' |
	 * 'triangle' | 'diamond' | 'pin'`) and renders each distinctly — but Lightweight has no
	 * equivalent for any of them and collapses all of them to `'square'`, so these extras are
	 * NOT guaranteed consistent and should only be used where cross-engine parity doesn't matter.
	 *
	 * Vela's native renderer has no per-marker shape support at all (only a chart-wide
	 * circle-vs-cross distinction at the series level, not exposed here): every marker renders
	 * as a circle regardless of `icon`.
	 */
	icon?: string;
	color?: string;
	position?: string;
	symbolSize?: number;
};

export interface TimeSeriesChartAdapter {
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
}
