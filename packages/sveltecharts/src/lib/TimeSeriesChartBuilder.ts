import {
	type SeriesOption,
	type LineSeriesOption,
	type DataZoomComponentOption,
	type LegendComponentOption
} from 'echarts';
import { type EChartsOption, type ECharts } from '$lib';
import type {
	ChartDatasetFormatSimpleObject,
	ChartMarkerPointOptions,
	OHLCDimensions
} from './chartAdapter';

import type { GridOption } from 'echarts/types/dist/shared';
import type { ZRColor } from 'echarts/types/src/util/types.js';
import type { MarkPointDataItemOption } from 'echarts/types/src/component/marker/MarkPointModel.js';

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

type DatasetFormatSimpleObject = Record<string, number[]>;
type DatasetFormatObject = Record<string, any>[];
type DatasetFormatArray = number[][];

/**
 *
 * ConfigBuilder:
 * externalManagerLegend: Hides EChart legends to allow external management
 *
 */
type ConfigBuilder = {
	externalManagerLegend?: boolean;
};
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
const CANDLESTICK_SERIES_ID = 'candlestick';

export class TimeSeriesChartBuilder {
	public ECharts: ECharts;
	private builderConfig: ConfigBuilder = {
		externalManagerLegend: false
	};
	private option: EChartsOption = {};
	private yDimensions!: string[];
	private yDimensionNames?: string[];
	private _tsColumn: string = '_ts';
	private _ohlcDims: OHLCDimensions | null = null;

	constructor(instance: ECharts, builderConfig?: ConfigBuilder) {
		this.ECharts = instance;
		this.builderConfig = { ...this.builderConfig, ...builderConfig };

		this.option.useUTC = true;
		this.option.animation = false;

		this.option.legend = this.builderConfig.externalManagerLegend
			? {
					show: false,
					selected: {}
				}
			: {
					top: '5%',
					selected: {}
				};

		this.option.grid = {
			top: '10%',
			left: '3%',
			right: '4%',
			bottom: '15%',
			containLabel: true
		};

		this.option.dataZoom = [
			{
				type: 'inside',
				filterMode: 'filter',
				zoomOnMouseWheel: true,
				moveOnMouseMove: true,
				realtime: true,
				start: 45,
				end: 55
			},
			{
				top: '86%',
				left: '8%',
				right: '8%',
				bottom: '5%',
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
			axisLine: { show: true },
			axisLabel: {
				formatter: (value: number) => {
					const d = new Date(value);
					return d.toTimeString().slice(0, 8);
				}
			}
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
	setDataset(
		data: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject,
		yDimensionsNames?: string[]
	): this {
		if (!Array.isArray(data)) {
			this.setDataByObjectSimple(data, yDimensionsNames);
		} else {
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
		}

		return this.build();
	}

	/**
	 * Loads OHLC data and renders a candlestick series.
	 * data must be a columnar object: { _ts: number[], open: number[], high: number[], low: number[], close: number[] }
	 * dims specifies the column names for each OHLC role.
	 *
	 * Calling this method multiple times replaces any existing candlestick series in place.
	 */
	setCandlestickSeries(data: ChartDatasetFormatSimpleObject, dims: OHLCDimensions): this {
		this._tsColumn = Object.keys(data)[0];

		this.yDimensions = [dims.open, dims.high, dims.low, dims.close];
		this.yDimensionNames = [dims.open, dims.high, dims.low, dims.close];
		this._ohlcDims = dims;

		if (this.option.dataset && !Array.isArray(this.option.dataset)) {
			this.option.dataset.dimensions = [this._tsColumn, dims.open, dims.high, dims.low, dims.close];
			this.option.dataset.source = data;
		}

		const selected = (this.option.legend as LegendComponentOption).selected as Record<
			string,
			boolean
		>;
		Object.assign(selected, { Candlestick: true });

		this.removeCandlestickSeries();

		(this.option.series as SeriesOption[]).push({
			type: 'candlestick',
			id: CANDLESTICK_SERIES_ID,
			name: 'Candlestick',
			encode: {
				x: this._tsColumn,
				// ECharts candlestick encode order: [open, close, low, high]
				y: [dims.open, dims.close, dims.low, dims.high]
			},
			animation: false,
			progressive: 4000,
			progressiveThreshold: 3000,
			itemStyle: {
				color: '#26a69a',
				color0: '#ef5350',
				borderColor: '#26a69a',
				borderColor0: '#ef5350'
			}
		} as SeriesOption);

		return this.build();
	}

	/**
	 * Removes the candlestick series (if any) and clears OHLC state.
	 * Useful before switching back to line rendering on the same builder instance.
	 */
	clearCandlestickSeries(): this {
		if (!this._ohlcDims) return this;

		this.removeCandlestickSeries();
		this._ohlcDims = null;

		const selected = (this.option.legend as LegendComponentOption).selected as Record<
			string,
			boolean
		>;
		delete selected['Candlestick'];

		// Force ECharts to drop the removed candlestick from its internal state.
		this.ECharts.setOption(this.option, {
			lazyUpdate: true,
			notMerge: false,
			replaceMerge: ['dataset', 'series']
		});

		return this;
	}

	private removeCandlestickSeries(): void {
		if (!Array.isArray(this.option.series)) return;
		this.option.series = (this.option.series as SeriesOption[]).filter(
			(s) => (s as { id?: string }).id !== CANDLESTICK_SERIES_ID
		);
	}

	toggleLegend(column: string): this {
		if (!column || !this.ECharts) return this;
		const selected = this.getColumnsSelected();
		selected[column] = !selected[column];

		this.ECharts.dispatchAction({
			type: 'legendToggleSelect',
			name: column
		});
		return this;
	}

	goToZoom(start: number, end: number): this {
		this.ECharts.dispatchAction({
			type: 'dataZoom',
			dataZoomIndex: 0,
			start,
			end
		});

		return this;
	}

	scrollToTime(timestamp: number): this {
		const [min, max] = this.getRangeValues();
		if (!min || !max) return this;

		const range = max - min;
		const targetPercent = ((timestamp - min) / range) * 100;
		const windowSize = 5;
		const start = Math.max(0, targetPercent - windowSize / 2);
		const end = Math.min(100, targetPercent + windowSize / 2);

		this.ECharts.dispatchAction({
			type: 'dataZoom',
			start,
			end
		});

		setTimeout(() => {
			this.ECharts.dispatchAction({
				type: 'showTip',
				seriesIndex: 0,
				dataIndex: this.findClosestDataIndex(timestamp)
			});
		}, 100);

		return this;
	}

	private findClosestDataIndex(timestamp: number): number {
		const dataset = this.option.dataset as {
			source: DatasetFormatSimpleObject;
			dimensions: string[];
		};
		const ts = (dataset?.source as DatasetFormatSimpleObject)?.[this._tsColumn] ?? [];
		if (!ts.length) return 0;

		let closest = 0;
		let minDiff = Math.abs(ts[0] - timestamp);

		for (let i = 1; i < ts.length; i++) {
			const diff = Math.abs(ts[i] - timestamp);
			if (diff < minDiff) {
				minDiff = diff;
				closest = i;
			}
		}
		return closest;
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

		this._tsColumn = timeDimensionKey;
		/**
		 * TimeDimensionName is the name of the time dimension.
		 */
		const timeDimensionName = xAxisName || this._tsColumn;

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
		this.createSeriesData(this._tsColumn, timeDimensionName);
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

		this._tsColumn = timeDimensionKey;

		// If custom dimension names are specified, those values will be used.
		// By default, the dimensions will keep the same names as the original keys.
		const timeDimensionName = dimensionsNames ? dimensionsNames.shift() : this._tsColumn;

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
			this.option.dataset.dimensions = [this._tsColumn, ...this.yDimensions];
			this.option.dataset.source = data;
		}
		this.createSeriesData(this._tsColumn, timeDimensionName);
	}

	private setDataByObjectSimple(data: DatasetFormatSimpleObject, dimensionsNames?: string[]) {
		// All dimensions are obtained based on the keys of the first element in the array.
		// The first dimension, corresponding to time, is separated.
		const dimensionKeys = Object.keys(data);

		const timeDimensionKey = dimensionKeys.shift();

		if (timeDimensionKey === undefined) {
			throw new Error('No time dimension found.');
		}

		this._tsColumn = timeDimensionKey;

		// If custom dimension names are specified, those values will be used.
		// By default, the dimensions will keep the same names as the original keys.
		const timeDimensionName = dimensionsNames ? dimensionsNames.shift() : this._tsColumn;

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
			this.option.dataset.dimensions = [this._tsColumn, ...this.yDimensions];
			this.option.dataset.source = data;
		}

		this.createSeriesData(this._tsColumn, timeDimensionName);
	}

	addDimension(data: DatasetFormatSimpleObject, dimName: string) {
		this.yDimensions.push(dimName);
		this.yDimensionNames?.push(dimName);

		if (this.option.dataset && !Array.isArray(this.option.dataset) && this.option.dataset.source) {
			this.option.dataset.dimensions?.push(dimName);
			Object.assign(this.option.dataset.source, data);
		}

		Object.keys(data).forEach((key) => this.addSeries(key, dimName, true));

		this.build();

		return this;
	}

	private getColumnsSelected() {
		const selected = (this.option.legend as LegendComponentOption).selected as Record<
			string,
			boolean
		>;
		return selected;
	}

	addSeries(dim: string, dimName: string, isSelected: boolean) {
		const percentageFields = this.detectPercentageFields();

		const isPercentage = percentageFields.includes(dim);
		const selected = this.getColumnsSelected();
		Object.assign(selected, { [dimName]: isSelected });

		const series = this.option.series as SeriesOption[];
		series.push({
			type: 'line',
			animation: false,
			id: dim,
			name: dimName,
			encode: { x: this._tsColumn, y: dim },
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
			lineStyle: { width: 1 },
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
		});
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
		id: number,
		data: {
			dimName: string;
			timestamp: number;
			name?: string;
		},
		options?: ChartMarkerPointOptions
	): this {
		try {
			const opt: MarkerPointOption = {
				icon: 'none',
				position: 'inside',
				symbolSize: 18,
				color: 'black',
				...(options as Partial<MarkerPointOption>)
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
					name: `markerpoint-${id}`,
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

		this.yDimensions.map((dim, inx) =>
			this.addSeries(
				dim,
				this.yDimensionNames![inx],
				(this.yDimensions.length > 1 && dim === 'price') || this.yDimensions.length === 1
			)
		);
	}

	/**
	 * Search for the dimension key and timestamp
	 */
	private searchValueByDimensionKeyAndTimestamp(yDimKey: string, timestamp: number): any {
		const dataset = this.option.dataset as {
			source: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject;
			dimensions: string[];
		};

		if (!dataset.dimensions.find((d) => d === yDimKey)) {
			throw new Error('No source data or dimensions found. Before loading data');
		}

		if (Array.isArray(dataset.source)) {
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
					return row[this._tsColumn] === timestamp;
				});
				if (!dataFind) {
					throw new Error(`No data found in timestamp ${timestamp}`);
				}
				return dataFind[yDimKey];
			}
		} else {
			const dataFind = dataset.source[this._tsColumn].indexOf(timestamp);
			if (dataFind === -1) {
				throw new Error(`No data found in timestamp ${timestamp}`);
			}
			return dataset.source[yDimKey][dataFind];
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

	build() {
		const option = this.ECharts.getOption();
		if (
			option &&
			option.dataZoom &&
			Array.isArray(option.dataZoom) &&
			Array.isArray(this.option.dataZoom)
		) {
			this.option.dataZoom[0].start = option.dataZoom[0].start;
			this.option.dataZoom[0].end = option.dataZoom[0].end;
		}

		this.ECharts.setOption(this.option, {
			lazyUpdate: true,
			notMerge: false,
			replaceMerge: ['dataset']
		});

		return this;
	}

	getDimensionKeys() {
		return {
			y: this.yDimensionNames!,
			x: this._tsColumn
		};
	}

	getLegendStatus() {
		return this.getColumnsSelected();
	}

	getTotalRows() {
		const dataset = this.option.dataset as {
			source: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject;
			dimensions: string[];
		};
		if (Array.isArray(dataset.source)) {
			return dataset.source.length;
		} else {
			return dataset.source[this._tsColumn].length;
		}
	}

	private isSimpleObject(
		s: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject
	): s is DatasetFormatSimpleObject {
		return !Array.isArray(s) && typeof s === 'object' && s !== null;
	}

	private isRecordArray(
		source: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject
	): source is DatasetFormatObject {
		return Array.isArray(source) && (source.length === 0 || !Array.isArray(source[0]));
	}

	private isNumberMatrix(
		source: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject
	): source is DatasetFormatArray {
		return Array.isArray(source) && (source.length === 0 || Array.isArray(source[0]));
	}

	getRangeValues(): [number, number] {
		const dataset = this.option.dataset as {
			source: DatasetFormatArray | DatasetFormatObject | DatasetFormatSimpleObject;
			dimensions: string[];
		};

		const source = dataset.source;

		// ---- Record<string, any>[] ----
		if (this.isRecordArray(source)) {
			if (!source.length) return [0, 0];
			const objSource = source as DatasetFormatObject;

			const firstRow = objSource[0];
			const lastRow = objSource[objSource.length - 1];

			const first = firstRow[this._tsColumn];
			const last = lastRow[this._tsColumn];
			return [first, last];
		}

		// ---- number[][] ----
		if (this.isNumberMatrix(source)) {
			if (!source.length) return [0, 0];
			const matrixSource = source as DatasetFormatArray;

			const tsIndex = dataset.dimensions.indexOf(this._tsColumn);
			const idx = tsIndex === -1 ? 0 : tsIndex;

			const firstRow = matrixSource[0];
			const lastRow = matrixSource[matrixSource.length - 1];

			const first = firstRow[idx];
			const last = lastRow[idx];
			return [first, last];
		}

		// ---- Record<string, number[]> ----
		if (this.isSimpleObject(source)) {
			const col = source[this._tsColumn];
			if (!col?.length) return [0, 0];
			return [col[0], col[col.length - 1]];
		}

		return [0, 0];
	}

	toggleMarkers(id: number, dimName: string, shape: string) {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		if (Array.isArray(this.option.dataset)) {
			throw new Error('Series must be an array');
		}

		// Search for the dimension
		const seriesDimension = this.option.series.find((s: any) => {
			return s.encode && s.encode.y && s.encode.y === dimName;
		});

		const markerPoints = seriesDimension?.markPoint.data as MarkPointDataItemOption[];
		const point = markerPoints.find((mp) => mp.name === `markerpoint-${id}`);

		if (!point) {
			return this;
		}

		point.symbol = point.symbol === 'none' ? this.getIcon(shape as IconType) : 'none';

		this.build();
		return this;
	}

	clearMarkers(): this {
		if (!Array.isArray(this.option.series)) {
			return this;
		}

		for (const s of this.option.series as any[]) {
			if (s.markPoint) {
				s.markPoint.data = [];
			}
		}

		this.build();
		return this;
	}
}
