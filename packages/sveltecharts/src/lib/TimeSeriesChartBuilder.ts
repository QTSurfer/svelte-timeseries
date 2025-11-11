import { type SeriesOption, type LineSeriesOption, type DataZoomComponentOption } from 'echarts';
import { type EChartsOption, type ECharts } from '$lib';

import type { GridOption } from 'echarts/types/dist/shared';
import type { ZRColor } from 'echarts/types/src/util/types.js';

type IconType =
	| 'circle'
	| 'rect'
	| 'roundRect'
	| 'triangle'
	| 'diamond'
	| 'pin'
	| 'arrowUp'
	| 'arrowDown'
	| 'none';

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

type MarkerPointOption = {
	icon: IconType;
	color: ZRColor;
	position: LabelPosition;
	symbolSize: number;
};
type DatasetFormatObject = Record<string, any>[];
type DatasetFormatArray = number[][];

export type MarkerEvent = {
	name?: string;
	xAxis: number[];
	icon?: IconType;
	color?: ZRColor;
	position?: 'aboveBar' | 'belowBar';
};

export type MarkArea = {
	name?: string;
	xAxis: [number, number];
	color?: ZRColor;
};
export class TimeSeriesChartBuilder {
	private instance: ECharts;
	private option: EChartsOption = {};
	private yDimensions!: string[];
	private yDimensionNames?: string[];

	constructor(instance: ECharts) {
		this.instance = instance;

		this.option.animation = false;
		this.option.title = {
			left: 'center',
			top: 0
		};

		this.option.legend = {
			top: '10%',
			selected: {}
		};

		this.option.grid = {
			top: '20%',
			left: 150,
			right: 150,
			bottom: '15%'
		};

		this.option.dataZoom = [
			{
				type: 'inside',
				filterMode: 'filter',
				zoomOnMouseWheel: true,
				moveOnMouseMove: true,
				realtime: false,
				start: 45,
				end: 55
			},
			{
				type: 'slider',
				show: true,
				filterMode: 'filter',
				realtime: false
			}
		];

		this.option.tooltip = {
			trigger: 'axis',
			axisPointer: { type: 'cross' }
		};

		this.option.xAxis = {
			type: 'time',
			axisLine: { show: true }
		};

		this.option.yAxis = [
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
		];

		this.option.dataset = {
			dimensions: [],
			source: []
		};
		this.option.series = [];
	}

	/**
	 * Accepts data as rows: [timestamp, v1, v2, ...]
	 * Automatically generates line series for each value column (>=1).
	 */
	setDataset(data: DatasetFormatArray | DatasetFormatObject, yDimensionsNames?: string[]): this {
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
			this.setDatasetByArray(data, yDimensionsNames);
		} else if (this.isRecordArray(data)) {
			this.setDataByObject(data, yDimensionsNames);
		} else {
			throw new Error('Data must be an array');
		}

		return this.build();
	}

	toggleLegend(column: string): this {
		if (!column || !this.instance) return this;

		this.instance.dispatchAction({
			type: 'legendToggleSelect',
			name: column
		});
		return this;
	}

	/**
	 * data: [1658870400, 823, 95.8, ...]
	 * dimensionsNames: ['_ts', 'price', 'otherColumn', ...]
	 */
	private setDatasetByArray(
		data: DatasetFormatArray,
		dimensionsNames: string[],
		xAxisName?: string
	) {
		// Build series based on number of columns (minus the time column).
		const columns = Array.isArray(data) && data.length > 0 ? data[0].length : 0;
		const totalCol = Math.max(0, columns);

		if (totalCol !== dimensionsNames?.length) {
			throw new Error(
				`Dimensions length ${dimensionsNames?.length} does not match total columns ${totalCol}.`
			);
		}

		/**
		 * First column is the time dimension.
		 * ------
		 * _ts  |
		 * ------
		 */
		const timeDimensionKey = dimensionsNames.shift();

		if (timeDimensionKey === undefined) {
			throw new Error('No time dimension found.');
		}

		/**
		 * TimeDimensionName is the name of the time dimension.
		 */
		const timeDimensionName = xAxisName || timeDimensionKey;

		/**
		 * YDimensions are the column names.
		 * --------------------------------------------------------
		 * Column 1 | Column 2 | Column 3 | Column 4 | Column 5
		 * --------------------------------------------------------
		 */
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
		if (this.option.dataset && !Array.isArray(this.option.dataset)) {
			this.option.dataset.dimensions = [timeDimensionKey, ...this.yDimensions];
			this.option.dataset.source = data;
		}
		this.createSeriesData(timeDimensionKey, timeDimensionName);
	}

	/**
	 * Data is an array of objects.
	 * [
	 *	{_ts: 1658870400, price: 823, otherColumn: 95.8},
	 *  {...}
	 * ]
	 */
	private setDataByObject(data: DatasetFormatObject, dimensionsNames?: string[]) {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		// All dimensions are obtained based on the keys of the first element in the array.
		// The first dimension, corresponding to time, is separated.
		const dimensionKeys = Object.keys(data[0]);
		const timeDimensionKey = dimensionKeys.shift();

		if (timeDimensionKey === undefined) {
			throw new Error('No time dimension found.');
		}

		// If custom dimension names are specified, those values will be used.
		// By default, the dimensions will keep the same names as the original keys.
		const timeDimensionName = dimensionsNames ? dimensionsNames.shift() : timeDimensionKey;

		/**
		 * `yDimensions` represents all data keys except the time dimension.
		 * -------------------
		 * price | otherColumn
		 * -------------------
		 */
		this.yDimensions = dimensionKeys;

		// If custom dimension names are specified, those values will be used.
		// By default, the dimensions will keep the same names as the original keys.
		this.yDimensionNames = dimensionsNames || dimensionKeys;

		if (this.option.dataset && !Array.isArray(this.option.dataset)) {
			this.option.dataset.dimensions = [timeDimensionKey, ...this.yDimensions];
			this.option.dataset.source = data;
		}
		this.createSeriesData(timeDimensionKey, timeDimensionName);
	}

	/**
	 * Tooltip bound to axis with a crosshair pointer.
	 */
	setAxisTooltip(): this {
		this.option.tooltip = {
			...this.option.tooltip
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
	 * Adds a marker event to the chart.
	 */
	addMarkerEvents(data: MarkerEvent[], widthLine: number = 1): this {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		for (const event of data) {
			const position = event.position || 'aboveBar';

			this.option.series.push({
				type: 'line',
				data: [],
				markLine: {
					symbol: this.getIcon(event.icon || 'none'),
					symbolSize: [15, 15],
					symbolOffset: [
						[0, 15],
						[0, 15]
					],
					label: {
						position: position === 'aboveBar' ? 'insideEnd' : 'insideStart',
						offset: position === 'aboveBar' ? [-35, 0] : [35, 0],
						distance: 0,
						color: 'white',
						formatter: event.name || '',
						fontSize: 12,
						fontFamily: 'Arial',
						fontStyle: 'normal',
						padding: 8,
						backgroundColor: event.name ? (event.color?.toString() ?? 'white') : undefined,
						borderRadius: 4
					},
					emphasis: {
						disabled: true
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

		return this.build();
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

		return this.build();
	}

	private getIcon(icon: IconType): string {
		const arrowUpPath =
			'path://M7.414 27.414l16.586-16.586v7.172c0 1.105 0.895 2 2 2s2-0.895 2-2v-12c0-0.809-0.487-1.538-1.235-1.848-0.248-0.103-0.508-0.151-0.765-0.151v-0.001h-12c-1.105 0-2 0.895-2 2s0.895 2 2 2h7.172l-16.586 16.586c-0.391 0.39-0.586 0.902-0.586 1.414s0.195 1.024 0.586 1.414c0.781 0.781 2.047 0.781 2.828 0z';

		const arrowDownPath =
			'path://M4.586 7.414l16.586 16.586h-7.171c-1.105 0-2 0.895-2 2s0.895 2 2 2h12c0.809 0 1.538-0.487 1.848-1.235 0.103-0.248 0.151-0.508 0.151-0.765h0.001v-12c0-1.105-0.895-2-2-2s-2 0.895-2 2v7.172l-16.586-16.586c-0.391-0.391-0.902-0.586-1.414-0.586s-1.024 0.195-1.414 0.586c-0.781 0.781-0.781 2.047 0 2.828z';

		const circlePath =
			'path://M16 0c-8.837 0-16 7.163-16 16s7.163 16 16 16 16-7.163 16-16-7.163-16-16-16zM16 28c-6.627 0-12-5.373-12-12s5.373-12 12-12c6.627 0 12 5.373 12 12s-5.373 12-12 12z';

		if (icon === 'arrowDown') {
			return arrowDownPath;
		}

		if (icon === 'arrowUp') {
			return arrowUpPath;
		}

		if (icon === 'circle') {
			return circlePath;
		}

		return icon;
	}

	addMarkerPoint(
		data: {
			dimName: string;
			timestamp: number;
			name?: string;
		},
		options?: Partial<MarkerPointOption>
	): this {
		try {
			const opt: MarkerPointOption = {
				icon: 'none',
				position: 'inside',
				symbolSize: 18,
				color: 'black',
				...options
			};

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

			/**
			 * Creates a data point for the marker
			 */
			const dataPoint = () => {
				return {
					coord: [data.timestamp, value],
					symbol: this.getIcon(opt.icon),
					symbolSize: opt.symbolSize,
					symbolOffset: [0, -1 * (opt.symbolSize * 3)],
					itemStyle: {
						color: opt.color,
						borderColor: opt.color,
						borderWidth: 2
					},
					label: {
						show: true,
						offset: [0, 30],
						formatter:
							data.name && Number(data.name)
								? Number(data.name).toFixed(2)
								: (data.name ?? value.toFixed(2)),
						fontSize: 12,
						fontWeight: 'bold',
						color: 'white',
						backgroundColor: opt.color,
						padding: 4,
						borderRadius: 4
					},
					z: 11
				};
			};

			// Create markPoint if it doesn't exist
			if (!seriesDimension.markPoint) {
				seriesDimension.markPoint = {
					data: [dataPoint()]
				};
			} else {
				seriesDimension.markPoint.data.push(dataPoint());
			}
		} catch (error: any) {
			console.error(error.message);
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

			if (this.option.legend && !Array.isArray(this.option.legend) && this.yDimensions.length > 1) {
				this.option.legend.selected = {
					...this.option.legend.selected,
					[this.yDimensionNames![inx]]: !(dim !== 'price')
				};
			}

			return {
				type: 'line',
				animation: false,
				id: dim,
				name: this.yDimensionNames![inx],
				encode: { x: timeDimensionKey, y: dim },
				emphasis: {
					focus: 'none',
					disabled: true
				},
				connectNulls: false,
				smooth: false,
				sampling: 'lttb',
				showSymbol: false,
				progressive: 4000,
				progressiveThreshold: 3000,
				progressiveChunkMode: 'mod',
				silent: true,
				clip: true,
				lineStyle: { width: lineStyleWidth },
				yAxisIndex: isPercentage ? 1 : 0,
				label: {
					show: true,
					backgroundColor: '#000000ff',
					color: '#fff',
					fontSize: 10,
					fontWeight: 'bold',
					borderRadius: 3,
					padding: [5, 5, 5, 5],
					position: 'inside',
					z: 10,
					formatter(params) {
						if (!params.seriesId || !params.data) return '';
						const value = params.data as Record<string, any>;

						if (value[params.seriesId]) {
							return `${value[params.seriesId].toFixed(2)}${isPercentage ? '%' : ''}`;
						}

						const idx = params.componentIndex + 1;
						if (value[idx]) {
							return `${value[idx].toFixed(2)}${isPercentage ? '%' : ''}`;
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

	private build() {
		this.instance.setOption(this.option, {
			lazyUpdate: true,
			notMerge: false,
			replaceMerge: ['series', 'legend']
		});
		return this;
	}
}
