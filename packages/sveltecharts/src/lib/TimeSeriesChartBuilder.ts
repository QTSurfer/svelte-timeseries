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
			tooltip: {},
			xAxis: {
				type: 'time'
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
						formatter: '{value} %'
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
	setDataset(data: Row[], yDimensions?: string[]): this {
		// Build series based on number of columns (minus the time column).
		const columns = Array.isArray(data) && data.length > 0 ? data[0].length : 0;
		const totalCol = Math.max(0, columns - 1);

		if (totalCol !== yDimensions?.length) {
			throw new Error(
				`Dimensions length ${yDimensions?.length} does not match total columns ${totalCol}.`
			);
		}

		/**
		 * Dimensions are the column names.
		 * --------------------------------------------------------
		 * | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
		 * --------------------------------------------------------
		 */

		this.yDimensions = yDimensions;

		/**
		 * Dataset is an array of rows.
		 * --------------------------------------------------------------------------------
		 * Dimensions |    TIME    | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
		 * --------------------------------------------------------------------------------
		 * Source     | 1658870400 |  32.4    |  32.7    |  32.8    |  32.9    |  32.5    |
		 * --------------------------------------------------------------------------------
		 */

		this.option.dataset = {
			dimensions: ['time', ...yDimensions],
			source: data
		};

		/** Automatically set line width based on number of columns */
		const lineStyleWidth = 1;

		this.option.xAxis = { type: 'time' };
		this.option.series = yDimensions.map((dim) => ({
			type: 'line',
			name: dim,
			encode: { x: 'time', y: dim },
			emphasis: {
				focus: 'series'
			},
			connectNulls: false,
			smooth: false,
			sampling: 'lttb',
			progressive: 10000,
			progressiveThreshold: 100000,
			progressiveChunkMode: 'mod',
			silent: true,
			clip: true,
			lineStyle: { width: lineStyleWidth }
		}));

		return this;
	}

	/**
	 * Tooltip bound to axis with a crosshair pointer.
	 */
	setAxisTooltip(): this {
		this.option.tooltip = {
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
		} = {
			icon: 'pin',
			position: 'inside'
		}
	): this {
		if (!Array.isArray(this.option.series)) {
			throw new Error('Series must be an array');
		}

		if (Array.isArray(this.option.dataset)) {
			this.option.dataset;
			throw new Error('Series must be an array');
		}

		if (!Array.isArray(this.option?.dataset?.source) || !this.option.dataset.dimensions?.length) {
			throw new Error('No data found');
		}

		// Search for the dimension
		const series = this.option.series.find((s: any) => s.name === data.dimName);
		if (!series) throw new Error(`Dimension ${data.dimName} not found`);

		// Search for the timestamp
		const dataset = this.option.dataset as { source: number[][] };

		const dataFind =
			dataset.source.find((row) => {
				return row[0] === data.timestamp;
			}) || [];

		if (!dataFind) {
			throw new Error(`No data found in timestamp ${data.timestamp}`);
		}
		const dimensionKey = this.option.dataset.dimensions.findIndex((d) => d === data.dimName);
		const value = dataFind[dimensionKey];

		if (!value) {
			throw new Error(`No value found in dimension ${data.dimName}`);
		}

		// Create markPoint if it doesn't exist
		if (!series.markPoint) {
			series.markPoint = {
				symbol: opt.icon || 'pin',
				symbolSize: 50,
				itemStyle: {
					color: opt.color,
					borderColor: '#fff',
					borderWidth: 1
				},
				data: [
					{
						coord: [data.timestamp, value],
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
}
