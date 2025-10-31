import type {
	EChartsOption,
	SeriesOption,
	LineSeriesOption,
	DataZoomComponentOption
} from 'echarts';
import type { GridOption } from 'echarts/types/dist/shared';
import type {
	OptionDataItemOriginal,
	OptionDataValue,
	OptionSourceData,
	OptionSourceDataArrayRows,
	SeriesLabelOption,
	ZRColor
} from 'echarts/types/src/util/types.js';

type Row = number[]; // [time, v1, v2, ...]
type IconType = 'circle' | 'rect' | 'roundRect' | 'triangle' | 'diamond' | 'pin' | 'arrow' | 'none';
type LabelPosition =
	| 'top'
	| 'left'
	| 'right'
	| 'bottom'
	| 'inside'
	| 'insideLeft'
	| 'insideRight'
	| 'insideTop'
	| 'insideBottom'
	| 'insideTopLeft'
	| 'insideBottomLeft'
	| 'insideTopRight'
	| 'insideBottomRight';

type DatasetFormatObject = Record<string, any>[];
type DatasetFormatArray = number[][];

export type MarkerEvent = {
	name?: string;
	xAxis: number[];
	icon?: IconType;
	color?: ZRColor;
};

export type MarkArea = {
	name?: string;
	xAxis: [number, number];
	color?: ZRColor;
};
export class TimeSeriesChartBuilder {
	private option: EChartsOption;
	private yDimensions?: string[];
	private yDimensionNames?: string[];

	constructor() {
		this.option = {
			animation: false,
			title: {
				left: 'center',
				top: 0
			},
			legend: {
				top: '10%'
			},
			grid: {
				top: '20%',
				left: 150,
				right: 150,
				bottom: '15%'
			},
			dataZoom: [
				{
					type: 'inside',
					filterMode: 'filter',
					zoomOnMouseWheel: true,
					moveOnMouseMove: true,
					realtime: false,
					start: 32,
					end: 64
				},
				{
					type: 'slider',
					show: true,
					filterMode: 'filter',
					realtime: false
				}
			],
			tooltip: {
				trigger: 'item',
				valueFormatter: (value) => {
					return `${value}`;
				}
			},
			xAxis: {
				type: 'time',
				axisLine: { show: true }
			},
			yAxis: [
				{
					type: 'value',
					scale: true,
					splitLine: { show: false },
					axisLine: { show: true, lineStyle: { type: 'dashed' } }
				},
				{
					type: 'value',
					scale: true,
					splitLine: { show: false },
					axisLine: { show: true, lineStyle: { type: 'dashed' } },
					axisLabel: {
						formatter: (value) => `${value.toFixed(2)}%`
					},
					name: '%'
				}
			],
			dataset: { source: [] },
			series: []
		};
	}

	/**
	 * Accepts data as rows: [timestamp, v1, v2, ...]
	 * Automatically generates line series for each value column (>=1).
	 */
	setDataset(
		data: DatasetFormatArray | DatasetFormatObject,
		yDimensionsNames?: string[],
		xAxisName?: string
	): this {
		if (!Array.isArray(data)) {
			throw new Error('Data must be an array');
		}

		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		if (this.isNumberArray(data)) {
			if (!yDimensionsNames?.length) {
				throw new Error('Requires yDimensionsNames. e.g. ["v1", "v2", "v3"]');
			}
			this.setDatasetByArray(data, yDimensionsNames, xAxisName);
		} else if (this.isRecordArray(data)) {
			this.setDataByObject(data, yDimensionsNames, xAxisName);
		} else {
			throw new Error('Data must be an array');
		}

		return this;
	}

	/**
	 * Accepts data as rows: [timestamp, v1, v2, ...]
	 * Automatically generates line series for each value column (>=1).
	 */
	setDatasetByArray(data: DatasetFormatArray, dimensionsNames: string[], xAxisName?: string): this {
		// Build series based on number of columns (minus the time column).
		const columns = Array.isArray(data) && data.length > 0 ? data[0].length : 0;
		const totalCol = Math.max(0, columns - 1);

		if (totalCol !== dimensionsNames?.length) {
			throw new Error(
				`Dimensions length ${dimensionsNames?.length} does not match total columns ${totalCol}.`
			);
		}

		/**
		 * Dimensions are the column names.
		 * --------------------------------------------------------
		 * Time | Column 1 | Column 2 | Column 3 | Column 4 | Column 5
		 * --------------------------------------------------------
		 */
		const timeDimensionKey = xAxisName || 'Time';

		this.yDimensions = dimensionsNames;
		this.yDimensionNames = dimensionsNames;

		/**
		 * Dataset is an array of rows.
		 * --------------------------------------------------------------------------------
		 * Dimensions |    TIME    | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
		 * --------------------------------------------------------------------------------
		 * Source     | 1658870400 |  32.4    |  32.7    |  32.8    |  32.9    |  32.5    |
		 * --------------------------------------------------------------------------------
		 */
		this.option.dataset = {
			dimensions: [timeDimensionKey, ...this.yDimensions],
			source: data
		};

		/** Automatically set line width based on number of columns */
		this.createSeriesData(timeDimensionKey, timeDimensionKey);

		return this;
	}

	/**
	 * Data is an array of objects.
	 * [
	 *	{_ts: 1658870400, count: 823, score: 95.8},
	 *  {...}
	 * ]
	 */
	setDataByObject(data: DatasetFormatObject, dimensionsNames?: string[], xAxisName?: string): this {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		// Get dimensions from first row
		const dimensionKeys = Object.keys(data[0]);
		const timeDimensionKey = dimensionKeys.shift();

		if (timeDimensionKey === undefined) {
			throw new Error('No time dimension found.');
		}
		const timeDimensionName = xAxisName || timeDimensionKey;

		this.yDimensions = dimensionKeys;
		this.yDimensionNames = dimensionsNames || dimensionKeys;

		this.option.dataset = {
			dimensions: [timeDimensionKey, ...this.yDimensions],
			source: data
		};

		this.createSeriesData(timeDimensionKey, timeDimensionName);
		return this;
	}

	/**
	 * Tooltip bound to axis with a crosshair pointer.
	 */
	setAxisTooltip(): this {
		this.option.tooltip = {
			...this.option.tooltip,
			trigger: 'axis',
			axisPointer: { type: 'cross' }
		};
		return this;
	}

	/**
	 * Legend with a custom icon (e.g., 'circle', 'rect').
	 */
	setLegendIcon(icon: IconType): this {
		this.option.legend = {
			...this.option.legend,
			icon
		};
		return this;
	}

	/**
	 * Adds both inside and slider dataZoom.
	 */
	setDataZoom(zoomOptions: DataZoomComponentOption): this {
		this.option.dataZoom = zoomOptions;
		return this;
	}

	setGrid(gridOption: GridOption): this {
		this.option.grid = {
			...this.option.grid,
			...gridOption
		};
		return this;
	}

	/**
	 * Sets chart title and optional subtitle, centered.
	 */
	setTitle(text: string, subtext?: string): this {
		this.option.title = {
			...this.option.title,
			text,
			subtext
		};
		return this;
	}

	/**
	 * Applies a partial style to all existing series (e.g., { smooth: true, symbol: 'none' }).
	 */
	setSeriesStyle(style: Partial<LineSeriesOption>): this {
		if (Array.isArray(this.option.series)) {
			this.option.series = this.option.series.map((s) => ({
				...(s as object),
				...(style as object)
			})) as SeriesOption[];
		}
		return this;
	}

	/**
	 * Returns the built ECharts option.
	 */
	build(): EChartsOption {
		// Shallow clone is fine for typical ECharts options here.
		return { ...this.option };
	}

	/**
	 * Adds a marker event to the chart.
	 */
	addMarkerEvents(data: MarkerEvent[], widthLine: number = 2): this {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		for (const event of data) {
			this.option.series.push({
				type: 'line',
				data: [],
				markLine: {
					symbol: event.icon || 'none',
					label: {
						position: 'end',
						formatter: event.name || '',
						fontWeight: 'bold',
						fontSize: 11
					},
					lineStyle: {
						color: event.color,
						width: widthLine,
						type: 'dashed'
					},
					data: event.xAxis.map((x) => ({ xAxis: x }))
				}
			});
		}

		return this;
	}

	/**
	 * Adds a marker area event to the chart.
	 */
	addMarkArea(data: MarkArea[]): this {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		for (const event of data) {
			this.option.series.push({
				type: 'line',
				data: [],
				markArea: {
					itemStyle: {
						color: event.color || 'rgba(0, 17, 255, 0.1)'
					},
					label: {
						position: 'top',
						formatter: event.name || '',
						fontWeight: 'bold',
						fontSize: 11
					},
					data: [
						[
							{
								xAxis: event.xAxis[0]
							},
							{
								xAxis: event.xAxis[1]
							}
						]
					]
				}
			});
		}

		this.addMarkerEvents(
			data.map((e) => ({ ...e, name: undefined })),
			1
		);

		return this;
	}

	addMarkerPoint(
		data: {
			dimName: string;
			timestamp: number;
			name?: string;
		},
		opt: {
			icon?: IconType;
			color?: ZRColor;
			position?: LabelPosition;
			symbolSize?: number;
		} = {
			icon: 'pin',
			position: 'inside',
			symbolSize: 50
		}
	): this {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		if (Array.isArray(this.option.dataset)) {
			throw new Error('Series must be an array');
		}

		// Search for the dimension
		const seriesDimension = this.option.series
			.filter((s: any) => s.encode && s.encode.y)
			.find((s: any) => {
				return s.encode.y === data.dimName;
			});

		if (!seriesDimension) throw new Error(`Dimension ${data.dimName} not found`);

		let value = this.searchValueByDimensionKeyAndTimestamp(data.dimName, data.timestamp);

		// Create markPoint if it doesn't exist
		if (!seriesDimension.markPoint) {
			seriesDimension.markPoint = {
				symbol: opt.icon,
				symbolSize: opt.symbolSize,
				itemStyle: {
					color: opt.color,
					borderColor: '#fff',
					borderWidth: 1
				},
				data: [
					{
						coord: [data.timestamp, value * 1.05],
						label: {
							show: true,
							position: opt.position,
							formatter: data.name ?? value.toFixed(2),
							fontSize: 12,
							fontWeight: 'bold'
						}
					}
				]
			};
		}

		return this;
	}

	private isRecordArray(arr: any[]): arr is DatasetFormatObject {
		return !Array.isArray(arr[0]) && typeof arr === 'object';
	}
	private isNumberArray(arr: any[]): arr is DatasetFormatArray {
		return Array.isArray(arr[0]);
	}

	/**
	 * Creates the series data
	 */
	private createSeriesData(timeDimensionKey: string, timeDimensionName?: string) {
		if (!this.yDimensions?.length || !this.yDimensionNames?.length) {
			throw new Error('No dimensions found.');
		}

		if (this.yDimensions.length !== this.yDimensionNames.length) {
			throw new Error(
				`Dimensions length ${this.yDimensionNames.length} does not match total columns ${this.yDimensions.length}.`
			);
		}

		const percentageFields = this.detectPercentageFields();

		/** Automatically set line width based on number of columns */
		const lineStyleWidth = 1;

		this.option.xAxis = { type: 'time', name: timeDimensionName };
		this.option.series = this.yDimensions.map((dim, inx) => {
			const isPercentage = percentageFields.includes(dim);
			return {
				type: 'line',
				id: dim,
				name: this.yDimensionNames![inx],
				encode: { x: timeDimensionKey, y: dim },
				emphasis: {
					focus: 'series'
				},
				connectNulls: false,
				smooth: false,
				sampling: 'lttb',
				showSymbol: false,
				progressive: 1800,
				progressiveThreshold: 100000,
				progressiveChunkMode: 'mod',
				silent: true,
				clip: true,
				lineStyle: { width: lineStyleWidth },
				yAxisIndex: isPercentage ? 1 : 0,
				z: 10,
				label: {
					show: true,
					backgroundColor: '#000000ff',
					color: '#fff',
					fontSize: 10,
					fontWeight: 'bold',
					borderRadius: 3,
					padding: [5, 5, 5, 5],
					position: 'inside',
					formatter(params) {
						if (!params.seriesId || !params.data) return '';
						const value = params.data as Record<string, any>;

						if (value[params.seriesId]) {
							return `${value[params.seriesId].toFixed(2)}${isPercentage ? '%' : ''}`;
						}
						return '-';
					}
				}
			};
		});
	}

	/**
	 * Search for the dimension key and timestamp
	 */

	private searchValueByDimensionKeyAndTimestamp(yDimKey: string, timestamp: number): any {
		const dataset = this.option.dataset as {
			source: DatasetFormatArray | DatasetFormatObject;
			dimensions: string[];
		};

		if (!Array.isArray(dataset.source) || !dataset.dimensions.length) {
			throw new Error('No source data or dimensions found. Before loading data');
		}

		if (this.isNumberArray(dataset.source)) {
			const dataFind = dataset.source.find((row) => {
				return row[0] === timestamp;
			});

			if (!dataFind) {
				throw new Error(`No data found in timestamp ${timestamp}`);
			}
			const yDimensionKey = dataset.dimensions.findIndex((d) => d === yDimKey);
			return dataFind[yDimensionKey];
		} else if (this.isRecordArray(dataset.source)) {
			const dataFind = dataset.source.find((row) => {
				return row._ts === timestamp;
			});
			if (!dataFind) {
				throw new Error(`No data found in timestamp ${timestamp}`);
			}
			return dataFind[yDimKey];
		} else {
			throw new Error('Incompatible data format');
		}
	}

	/**
	 * Return the percentage fields in the dataset
	 */
	private detectPercentageFields(): string[] {
		if (!this.yDimensions?.length) {
			throw new Error('No dimensions found.');
		}
		const percentFields = this.yDimensions.filter(
			(key) => !key.startsWith('_') && key.endsWith('%')
		);

		return percentFields;
	}
}
