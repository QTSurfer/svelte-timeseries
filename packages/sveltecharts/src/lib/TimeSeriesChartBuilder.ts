import {
	type SeriesOption,
	type LineSeriesOption,
	type DataZoomComponentOption,
	type LegendComponentOption
} from 'echarts';
import { type EChartsOption, type ECharts } from '$lib';
import type {
	ChartCapabilities,
	ChartDatasetFormatSimpleObject,
	ChartMarkerPointOptions,
	OHLCDimensions
} from './chartAdapter';
import {
	INJECTED_SERIES_PREFIX,
	MARKER_OVERLAY_STYLE,
	MARKER_SERIES_PREFIX,
	buildInjectedLineSeries,
	buildMarkPointItem,
	buildPaneLayout,
	lastIndexAtOrBefore
} from './echartsInjected';
import {
	groupMarkers,
	normalizeInjectedMarkers,
	type InjectedMarker,
	type MarkerGroup,
	type NormalizedMarker
} from './injectedMarkers';
import {
	defaultInjectedColor,
	diffInjectedSeries,
	hasGaps,
	normalizePane,
	resolvePaneIndexes,
	resolvePaneRatios,
	snapshotInjectedSeries,
	toEChartsLineData,
	toSortedColumns,
	type ColumnarSeries,
	type InjectedSeries,
	type InjectedSeriesSnapshot
} from './seriesInput';

import type { GridOption } from 'echarts/types/dist/shared';
import type { ZRColor } from 'echarts/types/src/util/types.js';
import type { MarkPointDataItemOption } from 'echarts/types/src/component/marker/MarkPointModel.js';
import { formatPreciseValue } from './pricePrecision';

type IconType =
	// Cross-engine-consistent set (see ChartMarkerPointOptions.icon's doc comment) — 'square' is
	// not a native ECharts symbol name, it's QTSurfer's cross-engine value mapped onto 'rect' in
	// getIcon below.
	| 'circle'
	| 'square'
	| 'arrowUp'
	| 'arrowDown'
	| 'none'
	// ECharts-only extras: render distinctly here, but collapse to 'square' in Lightweight and
	// are ignored entirely by Vela (always a circle) — not guaranteed consistent.
	| 'rect'
	| 'roundRect'
	| 'triangle'
	| 'diamond'
	| 'pin';

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

type DatasetFormatSimpleObject = ChartDatasetFormatSimpleObject;
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
	private overviewPaletteAdjusted = false;
	private injectedApplied = new Map<string, InjectedSeriesSnapshot>();
	private injectedState = new Map<
		string,
		{ request: InjectedSeries; columns: ColumnarSeries; autoColor: string }
	>();
	private injectedColorCount = 0;
	private injectedMarkers: NormalizedMarker[] = [];
	private paneHeights: Readonly<Record<number, number>> | undefined;
	/** The single-pane axes, saved while the stacked layout is active. */
	private paneBase: { grid: unknown; xAxis: unknown; yAxis: unknown } | null = null;
	private paneCount = 1;
	/** Components the next `build()` must replace instead of merge (removed series, pane changes). */
	private replaceComponents = new Set<string>();
	private reportedIssues = new Set<string>();
	private markerHoverAttached = false;
	private markerOverlay: HTMLElement | null = null;
	/** Tooltip HTML of the marker the pointer is on, while the overlay is shown. */
	private hoveredMarkerHtml: string | null = null;

	readonly capabilities: ChartCapabilities = {
		injectedSeries: true,
		panes: true,
		paneHeights: true,
		injectedMarkers: true,
		markerTooltip: true
	};

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
			axisPointer: { type: 'cross' },
			valueFormatter: (value) =>
				typeof value === 'number' ? formatPreciseValue(value) : String(value)
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
				axisLine: { show: true, lineStyle: { type: 'dashed' } },
				axisLabel: { formatter: formatPreciseValue }
			},
			{
				type: 'value',
				scale: true,
				splitLine: { show: false },
				axisLine: { show: true, lineStyle: { type: 'dashed' } },
				axisLabel: {
					formatter: (value) => `${formatPreciseValue(value)}%`
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

		this.refreshInjected();
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

		this.refreshInjected();
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
		let minDiff = Number.POSITIVE_INFINITY;

		for (let i = 0; i < ts.length; i++) {
			const value = ts[i];
			if (value === null) continue;
			const diff = Math.abs(value - timestamp);
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

		this.setOverviewSeries(data);
		this.createSeriesData(this._tsColumn, timeDimensionName);
	}

	private setOverviewSeries(data: DatasetFormatSimpleObject) {
		const timestamps = data[this._tsColumn] ?? [];
		const values = data[this.yDimensions[0]] ?? [];
		const points: [number, number][] = [];
		const stride = Math.max(1, Math.ceil(timestamps.length / 2000));
		for (let index = 0; index < timestamps.length; index += stride) {
			const timestamp = timestamps[index];
			const value = values[index];
			if (typeof timestamp === 'number' && typeof value === 'number') {
				points.push([timestamp, value]);
			}
		}
		const lastIndex = timestamps.length - 1;
		if (
			lastIndex >= 0 &&
			typeof timestamps[lastIndex] === 'number' &&
			typeof values[lastIndex] === 'number' &&
			points[points.length - 1]?.[0] !== timestamps[lastIndex]
		) {
			points.push([timestamps[lastIndex] as number, values[lastIndex] as number]);
		}

		const series = this.option.series as SeriesOption[];
		const existing = series.findIndex((item) => item.id === '__overview');
		if (existing >= 0) series.splice(existing, 1);
		if (points.length < 2) return;

		series.unshift({
			id: '__overview',
			type: 'line',
			data: points,
			showSymbol: false,
			silent: true,
			tooltip: { show: false },
			lineStyle: { opacity: 0 },
			itemStyle: { opacity: 0 },
			animation: false,
			sampling: 'minmax'
		});
	}

	private lineSampling(dimension: string): 'lttb' | 'minmax' {
		const dataset = this.option.dataset;
		if (!dataset || Array.isArray(dataset) || !this.isSimpleObject(dataset.source)) {
			return 'lttb';
		}
		return dataset.source[dimension]?.some((value) => value == null) ? 'minmax' : 'lttb';
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
		const valueIndex = this.yDimensions.indexOf(dim) + 1;
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
			sampling: this.lineSampling(dim),
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

					if (typeof value[params.seriesId] === 'number') {
						return `${formatPreciseValue(value[params.seriesId])}${isPercentage ? '%' : ''}`;
					}

					if (typeof value[valueIndex] === 'number') {
						return `${formatPreciseValue(value[valueIndex])}${isPercentage ? '%' : ''}`;
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
		const target = this.paneBase ?? this.option;
		target.grid = {
			...(target.grid as object),
			...gridOption
		} as GridOption;
		if (this.paneBase) this.refreshInjected();
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

	/**
	 * `'none'` means "no icon specified" at the shared `ChartMarkerPointOptions` level (the
	 * Lightweight/Vela builders both fall back to a visible default shape for it) — but
	 * ECharts' own `symbol: 'none'` means "draw nothing at all", so passing it straight to
	 * `getIcon` renders an invisible marker with no error. Centralized here so every caller
	 * that resolves a marker's SHOWN icon (an initial `addMarkerPoint`, or `toggleMarkers`
	 * restoring one to visible) applies the same visible fallback — `toggleMarkers` restoring
	 * a marker whose underlying shape is `'none'` hit this exact bug a second time before this
	 * was centralized.
	 */
	private normalizeVisibleIcon(icon?: string): IconType {
		return icon === 'none' || !icon ? 'circle' : (icon as IconType);
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

		// 'square' is QTSurfer's cross-engine convenience value, not a native ECharts symbol
		// name (ECharts' own built-in set is circle/rect/roundRect/triangle/diamond/pin/arrow/
		// none). Mapped explicitly to its closest native equivalent, 'rect', rather than relying
		// on ECharts' own internal "unrecognized symbolType → rect" fallback (see
		// createSymbol/SymbolClz.buildPath in its source) — intentional and documented here
		// beats depending on an undocumented library internal.
		if (icon === 'square') {
			return 'rect';
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
			opt.icon = this.normalizeVisibleIcon(opt.icon);

			if (!Array.isArray(this.option.series)) {
				throw new Error('Series must be an array');
			}

			if (Array.isArray(this.option.dataset)) {
				throw new Error('Series must be an array');
			}

			// Search for the dimension (OHLC column names resolve to the candlestick series)
			const seriesDimension = this.findDimensionSeries(data.dimName);

			if (!seriesDimension) throw new Error(`Dimension ${data.dimName} not found`);

			let value = this.searchValueByDimensionKeyAndTimestamp(data.dimName, data.timestamp);
			if (value == null) return this;

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
								? formatPreciseValue(Number(data.name))
								: (data.name ?? formatPreciseValue(value)),
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

	/**
	 * Declares the named line series supplied by the host app (indicators, for instance).
	 *
	 * Declarative and incremental: series are matched by name, so new names are added, missing
	 * names are removed and changed ones are updated through `setOption` merging. The chart is
	 * not rebuilt and the zoom window is kept. `InjectedSeries.pane` above 0 stacks the series
	 * in its own grid under the price pane, sharing the time axis and crosshair.
	 */
	setInjectedSeries(input: readonly InjectedSeries[]): this {
		const diff = diffInjectedSeries(this.injectedApplied, input);
		this.reportIssues(diff.issues);
		if (!diff.removed.length && !diff.added.length && !diff.changed.length) {
			return this;
		}

		for (const name of diff.removed) {
			this.injectedState.delete(name);
			this.injectedApplied.delete(name);
		}
		if (diff.removed.length > 0) {
			this.replaceComponents.add('series');
		}
		for (const series of diff.added) {
			this.injectedState.set(series.name, {
				request: series,
				columns: toSortedColumns(series.times, series.values),
				autoColor: defaultInjectedColor(this.injectedColorCount++)
			});
		}
		for (const change of diff.changed) {
			const state = this.injectedState.get(change.series.name);
			if (!state) continue;
			state.request = change.series;
			if (change.data) state.columns = toSortedColumns(change.series.times, change.series.values);
		}
		for (const series of diff.valid) {
			this.injectedApplied.set(series.name, snapshotInjectedSeries(series));
		}
		// Injected series keep the order of the input.
		const order = new Map(diff.valid.map((series, index) => [series.name, index]));
		this.injectedState = new Map(
			[...this.injectedState].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
		);

		this.refreshInjected();
		return this.build();
	}

	/**
	 * Declares the markers supplied by the host app, drawn as mark points. They attach to the price
	 * series, or to the injected series named in `InjectedMarker.series`. Markers in the same UTC
	 * second that look alike are merged into one symbol with a count; the tooltip lists them all.
	 */
	setInjectedMarkers(input: readonly InjectedMarker[]): this {
		const { markers, issues } = normalizeInjectedMarkers(input);
		this.reportIssues(issues);
		this.injectedMarkers = markers;
		this.syncInjectedMarkPoints();
		return this.build();
	}

	/** Relative pane heights keyed by pane number (see `InjectedSeries.pane`). */
	setPaneHeights(heights: Readonly<Record<number, number>>): this {
		this.paneHeights = heights;
		if (this.injectedState.size > 0) {
			this.refreshInjected();
			this.build();
		}
		return this;
	}

	private hasPricePane(): boolean {
		return Boolean(this.yDimensions?.length) || this._ohlcDims !== null;
	}

	/**
	 * Rebuilds everything derived from the injected input: the pane layout, the series options and
	 * the mark points. Cheap (no data is copied) and idempotent, so it also runs when the primary
	 * dataset changes.
	 */
	private refreshInjected() {
		if (this.injectedState.size === 0 && this.injectedMarkers.length === 0 && !this.paneBase) {
			return;
		}

		const hasPrice = this.hasPricePane();
		const requested = new Map(
			[...this.injectedState].map(
				([name, state]) => [name, normalizePane(state.request.pane)] as const
			)
		);
		const targets = resolvePaneIndexes(requested, hasPrice);
		this.layoutPanes(resolvePaneRatios(this.paneHeights, requested.values(), hasPrice));

		const selected = this.getColumnsSelected();
		const kept = (this.option.series as SeriesOption[]).filter(
			(item) => !String((item as { id?: unknown }).id ?? '').startsWith(INJECTED_SERIES_PREFIX)
		);
		const injected: SeriesOption[] = [];
		for (const [name, state] of this.injectedState) {
			const pane = targets.get(name) ?? 0;
			const { request } = state;
			selected[name] = request.visible ?? true;
			injected.push(
				buildInjectedLineSeries({
					name,
					data: toEChartsLineData(state.columns),
					color: request.color ?? state.autoColor,
					lineWidth:
						typeof request.lineWidth === 'number' && request.lineWidth > 0 ? request.lineWidth : 1,
					lineStyle: request.lineStyle ?? 'solid',
					hasGaps: hasGaps(state.columns),
					xAxisIndex: pane,
					yAxisIndex: pane === 0 ? 0 : 1 + pane
				}) as SeriesOption
			);
		}
		this.option.series = [...kept, ...injected];
		this.syncInjectedMarkPoints();
	}

	/**
	 * Stacks `ratios.length` panes as separate grids that share the time range, or restores the
	 * single-pane layout. The pane count changes which components exist, so those are replaced on
	 * the next build instead of merged.
	 */
	private layoutPanes(ratios: readonly number[]) {
		const count = ratios.length;
		const zoomAxes = Array.from({ length: Math.max(count, 1) }, (_, index) => index);
		const dataZoom = Array.isArray(this.option.dataZoom) ? this.option.dataZoom : [];

		if (count <= 1) {
			const base = this.paneBase;
			if (!base) return;
			this.option.grid = base.grid as typeof this.option.grid;
			this.option.xAxis = base.xAxis as typeof this.option.xAxis;
			this.option.yAxis = base.yAxis as typeof this.option.yAxis;
			for (const zoom of dataZoom) (zoom as { xAxisIndex?: number[] }).xAxisIndex = [0];
			this.option.axisPointer = { link: [] };
			this.paneBase = null;
			this.paneCount = 1;
			this.replaceComponents.add('grid').add('xAxis').add('yAxis');
			return;
		}

		this.paneBase ??= {
			grid: this.option.grid,
			xAxis: this.option.xAxis,
			yAxis: this.option.yAxis
		};
		const base = this.paneBase;
		const baseXAxis = (Array.isArray(base.xAxis) ? base.xAxis[0] : base.xAxis) as Record<
			string,
			unknown
		>;
		const layout = buildPaneLayout(
			ratios,
			base.grid as Record<string, unknown>,
			baseXAxis,
			base.yAxis as Record<string, unknown>[]
		);
		this.option.grid = layout.grid as typeof this.option.grid;
		this.option.xAxis = layout.xAxis as typeof this.option.xAxis;
		this.option.yAxis = layout.yAxis as typeof this.option.yAxis;
		for (const zoom of dataZoom) (zoom as { xAxisIndex?: number[] }).xAxisIndex = zoomAxes;
		this.option.axisPointer = { link: [{ xAxisIndex: 'all' }] };

		if (this.paneCount !== count) {
			this.paneCount = count;
			this.replaceComponents.add('grid').add('xAxis').add('yAxis');
		}
	}

	/** Series drawn for a column. The OHLC columns all resolve to the candlestick series. */
	private findDimensionSeries(dimName: string): Record<string, any> | undefined {
		const all = this.option.series as Record<string, any>[];
		const direct = all.find((item) => item.encode && item.encode.y === dimName);
		if (direct) {
			return direct;
		}
		const isCandleColumn =
			this._ohlcDims !== null &&
			(dimName === 'Candlestick' || Object.values(this._ohlcDims).includes(dimName));
		return isCandleColumn ? all.find((item) => item.id === CANDLESTICK_SERIES_ID) : undefined;
	}

	private findMarkerHost(series: string | undefined): Record<string, any> | undefined {
		const all = this.option.series as Record<string, any>[];
		if (series !== undefined) {
			return (
				all.find((item) => item.id === `${INJECTED_SERIES_PREFIX}${series}`) ??
				all.find((item) => item.encode?.y === series)
			);
		}
		if (this._ohlcDims) {
			const candles = all.find((item) => item.id === CANDLESTICK_SERIES_ID);
			if (candles) return candles;
		}
		const primary = this.yDimensions?.[0];
		return (
			(primary === undefined ? undefined : all.find((item) => item.encode?.y === primary)) ??
			all.find((item) => String(item.id ?? '').startsWith(INJECTED_SERIES_PREFIX))
		);
	}

	/** Series value a marker without a price is anchored to (the bar at or before its time). */
	private hostValueAt(host: Record<string, any>, group: MarkerGroup): number | undefined {
		const id = String(host.id ?? '');
		let times: ArrayLike<number | null>;
		let values: ArrayLike<number | null | undefined>;

		if (id.startsWith(INJECTED_SERIES_PREFIX)) {
			const columns = this.injectedState.get(id.slice(INJECTED_SERIES_PREFIX.length))?.columns;
			if (!columns) return undefined;
			times = columns.times;
			values = columns.values;
		} else {
			const dataset = this.option.dataset;
			if (!dataset || Array.isArray(dataset) || !this.isSimpleObject(dataset.source)) {
				return undefined;
			}
			const source = dataset.source;
			times = source[this._tsColumn] ?? [];
			let column: string | undefined = host.encode?.y;
			if (id === CANDLESTICK_SERIES_ID && this._ohlcDims) {
				const dims = this._ohlcDims;
				column =
					group.position === 'belowBar'
						? dims.low
						: group.position === 'aboveBar'
							? dims.high
							: dims.close;
			}
			if (typeof column !== 'string') return undefined;
			values = source[column] ?? [];
		}

		// A marker before the first bar sits on the first bar, as on Lightweight Charts.
		let index = Math.max(lastIndexAtOrBefore(times, group.timeMs), 0);
		while (index > 0 && !Number.isFinite(values[index] as number)) index--;
		const value = values[index];
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	}

	/**
	 * Draws the injected markers as mark points of one helper series per host series (same axes and
	 * legend name, no data). A separate series keeps the host `silent` (cheap) and lets the mark
	 * points receive the pointer for the hover text.
	 */
	private syncInjectedMarkPoints() {
		const all = this.option.series as Record<string, any>[];
		const previous = all.filter((item) => String(item.id ?? '').startsWith(MARKER_SERIES_PREFIX));
		const rest = all.filter((item) => !String(item.id ?? '').startsWith(MARKER_SERIES_PREFIX));

		const byHost = new Map<Record<string, any>, NormalizedMarker[]>();
		for (const marker of this.injectedMarkers) {
			const host = this.findMarkerHost(marker.series);
			if (!host) continue; // waits for its series
			const list = byHost.get(host) ?? [];
			list.push(marker);
			byHost.set(host, list);
		}

		const helpers: Record<string, any>[] = [];
		let index = 0;
		for (const [host, markers] of byHost) {
			const points: unknown[] = [];
			// Glyphs already drawn above / below each bar (per second), to stack the next one.
			const stacked = new Map<string, number>();
			for (const group of groupMarkers(markers)) {
				const y = group.price ?? this.hostValueAt(host, group);
				if (y === undefined) {
					this.reportIssues([
						'An injected marker could not be placed because its series has no value at that time; give it a "price".'
					]);
					continue;
				}
				const side = `${group.second}|${group.position}`;
				const stack = stacked.get(side) ?? 0;
				stacked.set(side, stack + 1);
				points.push(buildMarkPointItem(group, index++, y, stack));
			}
			if (points.length === 0) continue;
			helpers.push({
				type: 'line',
				id: `${MARKER_SERIES_PREFIX}${host.id ?? helpers.length}`,
				// Same name as the host: the legend toggles the markers together with their series.
				name: host.name,
				data: [],
				xAxisIndex: host.xAxisIndex ?? 0,
				yAxisIndex: host.yAxisIndex ?? 0,
				silent: false,
				animation: false,
				tooltip: { show: false },
				markPoint: { silent: false, animation: false, data: points }
			});
		}

		if (previous.some((item) => !helpers.some((helper) => helper.id === item.id))) {
			this.replaceComponents.add('series');
		}
		this.option.series = [...rest, ...helpers] as SeriesOption[];

		// A marker that is replaced or removed under the pointer never reports `mouseout`.
		if (
			this.hoveredMarkerHtml !== null &&
			!helpers.some((helper) =>
				helper.markPoint.data.some(
					(point: { tooltipHtml?: string }) => point.tooltipHtml === this.hoveredMarkerHtml
				)
			)
		) {
			this.endMarkerHover();
		}
		this.attachMarkerHover();
	}

	/**
	 * Hover text for injected markers. The chart's axis-triggered tooltip takes precedence over any
	 * item tooltip, so the text is shown in a small overlay and the axis tooltip is paused while
	 * the pointer is on a marker.
	 */
	private attachMarkerHover() {
		if (
			this.markerHoverAttached ||
			typeof document === 'undefined' ||
			typeof this.ECharts.on !== 'function'
		) {
			return;
		}
		this.markerHoverAttached = true;

		const container = this.ECharts.getDom();
		const overlay = document.createElement('div');
		overlay.setAttribute('role', 'tooltip');
		overlay.style.cssText = MARKER_OVERLAY_STYLE;
		container.appendChild(overlay);
		this.markerOverlay = overlay;

		this.ECharts.on('mouseover', (params: unknown) => {
			const event = params as {
				componentType?: string;
				data?: { tooltipHtml?: string };
				event?: { offsetX: number; offsetY: number };
			};
			const html = event.componentType === 'markPoint' ? event.data?.tooltipHtml : undefined;
			if (!html || !event.event) return;

			overlay.innerHTML = html;
			overlay.style.display = 'block';
			const x = event.event.offsetX + 12;
			const overflow = x + overlay.offsetWidth > container.clientWidth;
			overlay.style.left = `${overflow ? Math.max(0, event.event.offsetX - overlay.offsetWidth - 12) : x}px`;
			overlay.style.top = `${Math.max(0, event.event.offsetY - 10)}px`;

			this.hoveredMarkerHtml = html;
			this.ECharts.setOption({ tooltip: { show: false } });
		});
		this.ECharts.on('mouseout', (params: unknown) => {
			if ((params as { componentType?: string }).componentType === 'markPoint') {
				this.endMarkerHover();
			}
		});
		this.ECharts.on('globalout', () => this.endMarkerHover());
	}

	/** Hides the marker overlay and gives the axis tooltip back. Safe to call at any time. */
	private endMarkerHover() {
		if (this.markerOverlay) {
			this.markerOverlay.style.display = 'none';
		}
		if (this.hoveredMarkerHtml !== null) {
			this.hoveredMarkerHtml = null;
			this.ECharts.setOption({ tooltip: { show: true } });
		}
	}

	private reportIssues(issues: readonly string[]) {
		for (const issue of issues) {
			if (this.reportedIssues.has(issue)) continue;
			this.reportedIssues.add(issue);
			console.warn(`[sveltecharts] ${issue}`);
		}
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
	 *
	 * Markers are sourced from a separate table/query than the price series (e.g. DuckDB's
	 * `markers` table), so a marker's timestamp is not guaranteed to land on an exact sample of
	 * the series it annotates — Lightweight Charts' createSeriesMarkers already tolerates this
	 * (it anchors purely by time, with no explicit value lookup at all). Exact-match lookups
	 * here silently dropped any marker whose timestamp didn't hit a sample exactly (caught by
	 * addMarkerPoint's try/catch, no error in the chart), so this finds the CLOSEST sample
	 * instead of requiring an exact hit.
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
				const source = dataset.source;
				const yDimensionKey = dataset.dimensions.findIndex((d) => d === yDimKey);
				const index = this.findClosestIndex(
					source.length,
					(i) => source[i][0],
					(i) => source[i][yDimensionKey],
					timestamp
				);
				if (index === -1) {
					throw new Error(`No data found in timestamp ${timestamp}`);
				}
				return source[index][yDimensionKey];
			} else if (this.isRecordArray(dataset.source)) {
				const source = dataset.source;
				const index = this.findClosestIndex(
					source.length,
					(i) => source[i][this._tsColumn],
					(i) => source[i][yDimKey],
					timestamp
				);
				if (index === -1) {
					throw new Error(`No data found in timestamp ${timestamp}`);
				}
				return source[index][yDimKey];
			}
		} else {
			const timestamps = dataset.source[this._tsColumn];
			const values = dataset.source[yDimKey];
			const index = this.findClosestIndex(
				timestamps.length,
				(i) => timestamps[i],
				(i) => values[i],
				timestamp
			);
			if (index === -1) {
				throw new Error(`No data found in timestamp ${timestamp}`);
			}
			return values[index];
		}
	}

	/**
	 * Index of the timestamp closest to `target`, among positions where the DIMENSION VALUE is
	 * also non-null. A "Partial data" dataset can have gaps (null) in the value column
	 * independently of the timestamp column, so the closest-timestamp row can land on exactly
	 * such a gap — this must keep searching past it (and past null timestamps) rather than
	 * anchoring the marker to a row with nothing to plot. Returns -1 if no row has both.
	 *
	 * Takes accessors rather than pre-built timestamp/value arrays: at 1.8M rows, copying both
	 * columns into new arrays for every single marker placed (addMarkerPoint runs once per
	 * marker) allocated tens of MB of throwaway arrays for a one-pass scan. Reading `source[i]`
	 * directly through the accessor costs the same per-element work without the copy.
	 */
	private findClosestIndex(
		length: number,
		getTime: (i: number) => number | null | undefined,
		getValue: (i: number) => number | null | undefined,
		target: number
	): number {
		let closest = -1;
		let smallestDiff = Number.POSITIVE_INFINITY;

		for (let i = 0; i < length; i++) {
			const time = getTime(i);
			if (time == null || getValue(i) == null) continue;
			const diff = Math.abs(time - target);
			if (diff < smallestDiff) {
				smallestDiff = diff;
				closest = i;
			}
		}

		return closest;
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

		const replaceMerge = ['dataset', ...this.replaceComponents];
		this.replaceComponents.clear();
		this.ECharts.setOption(this.option, {
			lazyUpdate: true,
			notMerge: false,
			replaceMerge
		});
		if (
			!this.overviewPaletteAdjusted &&
			Array.isArray(this.option.series) &&
			this.option.series.some((series) => series.id === '__overview')
		) {
			const palette = this.option.color ?? this.ECharts.getOption()?.color;
			if (Array.isArray(palette) && palette.length) {
				this.option.color = [palette[0], ...palette];
				this.ECharts.setOption({ color: this.option.color });
				this.overviewPaletteAdjusted = true;
			}
		}

		return this;
	}

	getDimensionKeys() {
		return {
			y: this.yDimensionNames!,
			x: this._tsColumn
		};
	}

	/** Visibility of the primary dataset's columns (injected series are controlled by their input). */
	getLegendStatus() {
		const selected = this.getColumnsSelected();
		if (this.injectedApplied.size === 0) {
			return selected;
		}
		return Object.fromEntries(
			Object.entries(selected).filter(([name]) => !this.injectedApplied.has(name))
		);
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

	getLoadedDimensions(): string[] {
		return [...this.yDimensions];
	}

	getActiveDimensions(): string[] {
		return this.getLoadedDimensions();
	}

	updateDimension(data: DatasetFormatSimpleObject, dimName: string) {
		return this.updateDimensions(data, [dimName]);
	}

	updateDimensions(data: DatasetFormatSimpleObject, dimNames: string[]) {
		const dataset = this.option.dataset;
		if (!dataset || Array.isArray(dataset) || !this.isSimpleObject(dataset.source)) return this;

		const source = dataset.source;

		if (data[this._tsColumn]) {
			source[this._tsColumn] = data[this._tsColumn];
		}
		for (const dimName of dimNames) {
			if (data[dimName]) {
				source[dimName] = data[dimName];
				const series = (this.option.series as SeriesOption[]).find((item) => item.id === dimName);
				if (series?.type === 'line') series.sampling = this.lineSampling(dimName);
			}
		}

		this.build();
		return this;
	}

	setDataRange(start: number, end: number) {
		const xAxis = this.option.xAxis;
		if (Array.isArray(xAxis)) {
			// Stacked panes share one time range; otherwise only the first axis is bounded.
			this.option.xAxis = xAxis.map((axis, index) =>
				index === 0 || this.paneBase ? { ...axis, min: start, max: end } : axis
			);
		} else {
			this.option.xAxis = { ...xAxis, min: start, max: end };
		}
		if (this.paneBase) {
			this.paneBase.xAxis = { ...(this.paneBase.xAxis as object), min: start, max: end };
		}
		return this.build();
	}

	private isSimpleObject(s: unknown): s is DatasetFormatSimpleObject {
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
			const timestamps = col.filter((timestamp): timestamp is number => timestamp !== null);
			if (!timestamps.length) return [0, 0];
			return [timestamps[0], timestamps[timestamps.length - 1]];
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
		const seriesDimension = this.findDimensionSeries(dimName);

		const markerPoints = seriesDimension?.markPoint?.data as MarkPointDataItemOption[] | undefined;
		// No markPoint at all means addMarkerPoint never actually placed this marker (e.g. its
		// value at that timestamp was null) — nothing to toggle.
		const point = markerPoints?.find((mp) => mp.name === `markerpoint-${id}`);

		if (!point) {
			return this;
		}

		point.symbol =
			point.symbol === 'none' ? this.getIcon(this.normalizeVisibleIcon(shape)) : 'none';

		this.build();
		return this;
	}

	clearMarkers(): this {
		if (!Array.isArray(this.option.series)) {
			return this;
		}

		for (const s of this.option.series as any[]) {
			// The helper series of injected markers follow `setInjectedMarkers`, not this call.
			if (s.markPoint && !String(s.id ?? '').startsWith(MARKER_SERIES_PREFIX)) {
				s.markPoint.data = [];
			}
		}

		this.build();
		return this;
	}
}
