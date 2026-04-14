export type ChartDatasetFormatSimpleObject = Record<string, number[]>;
export type ChartDatasetFormatObject = Record<string, any>[];
export type ChartDatasetFormatArray = number[][];

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
	icon?: string;
	color?: string;
	position?: string;
	symbolSize?: number;
};

export interface TimeSeriesChartAdapter {
	setLegendIcon(icon: string): this;
	setDataset(data: ChartDataset, yDimensionsNames?: string[]): this;
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
}
