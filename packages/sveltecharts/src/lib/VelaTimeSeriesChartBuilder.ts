import type { Vela, OHLCV, TimelineMark, MarkShape } from '@luxalgo/vela';
import type {
	ChartDataset,
	ChartDatasetFormatSimpleObject,
	ChartMarkerPoint,
	ChartMarkerPointOptions,
	OHLCDimensions,
	TimeSeriesChartAdapter
} from './chartAdapter';
import { getPricePrecision } from './pricePrecision';
export { getPricePrecision, formatPreciseValue } from './pricePrecision';

type ConfigBuilder = {
	externalManagerLegend?: boolean;
};

type MarkerState = {
	id: number;
	timestamp: number;
	color: string;
	shape: MarkShape;
	text?: string;
	visible: boolean;
};

const CANDLESTICK_GROUP = 'candlestick';

/**
 * Vela (`@luxalgo/vela`) renders a single market (symbol/timeframe/OHLCV), not
 * arbitrary N-dimension line series. This builder therefore only supports the
 * candlestick-oriented slice of {@link TimeSeriesChartAdapter}: setCandlestickSeries,
 * zoom/scroll, and marker points (approximated with Vela's timeline marks, since the
 * public API has no per-value price-anchored marker primitive). Generic multi-line
 * methods (setDataset, addDimension, ...) are not supported by this builder and throw.
 */
export class VelaTimeSeriesChartBuilder implements TimeSeriesChartAdapter {
	public VelaChart: Vela;
	private builderConfig: ConfigBuilder = {
		externalManagerLegend: false
	};
	private dataset: ChartDatasetFormatSimpleObject = {};
	private _tsColumn = '_ts';
	private _ohlcDims: OHLCDimensions | null = null;
	private markers = new Map<string, MarkerState[]>();
	private selected: Record<string, boolean> = {};

	constructor(instance: Vela, builderConfig?: ConfigBuilder) {
		this.VelaChart = instance;
		this.builderConfig = { ...this.builderConfig, ...builderConfig };
	}

	setLegendIcon(_icon: string): this {
		return this;
	}

	setDataset(_data: ChartDataset, _yDimensionsNames?: string[]): this {
		throw new Error(
			'VelaTimeSeriesChartBuilder does not support setDataset. Vela renders a single OHLCV market; use setCandlestickSeries instead.'
		);
	}

	/**
	 * Loads OHLC data and renders a candlestick series.
	 * data must be a columnar object: { _ts: number[], open: number[], high: number[], low: number[], close: number[] }
	 * dims specifies the column names for each OHLC role.
	 *
	 * Calling this method multiple times replaces the chart's market data in place.
	 */
	setCandlestickSeries(data: ChartDatasetFormatSimpleObject, dims: OHLCDimensions): this {
		this._tsColumn = Object.keys(data)[0];
		// Copy so later in-place updates (updateDimensions) never mutate the caller's object.
		this.dataset = { ...data };
		this._ohlcDims = dims;
		this.selected['Candlestick'] = true;

		this.VelaChart.setMarket({ data: this.toOHLCV(dims) });
		this.syncMarksGroup();

		return this;
	}

	addDimension(_data: ChartDatasetFormatSimpleObject, _dimName: string): this {
		throw new Error(
			'VelaTimeSeriesChartBuilder does not support addDimension. Vela renders a single OHLCV market.'
		);
	}

	build(): this {
		return this;
	}

	addMarkerPoint(id: number, data: ChartMarkerPoint, options?: ChartMarkerPointOptions): this {
		const markerState: MarkerState = {
			id,
			timestamp: data.timestamp,
			color: options?.color ?? '#000000',
			shape: this.mapShape(options?.icon),
			text: data.name,
			visible: true
		};

		const markers = this.markers.get(data.dimName) ?? [];
		markers.push(markerState);
		this.markers.set(data.dimName, markers);
		this.syncMarksGroup();
		return this;
	}

	getLegendStatus(): Record<string, boolean> {
		return this.selected;
	}

	toggleLegend(column: string): this {
		if (!column) return this;
		this.selected[column] = !(this.selected[column] ?? false);
		return this;
	}

	getRangeValues(): [number, number] {
		const timestamps = (this.dataset[this._tsColumn] ?? []).filter(
			(timestamp): timestamp is number => timestamp !== null
		);
		if (!timestamps.length) return [0, 0];
		return [timestamps[0], timestamps[timestamps.length - 1]];
	}

	goToZoom(start: number, end: number): this {
		const [min, max] = this.getRangeValues();
		if (!min && !max) return this;

		const width = max - min;
		this.VelaChart.setVisibleRange({
			from: min + width * (start / 100),
			to: min + width * (end / 100)
		});

		return this;
	}

	scrollToTime(timestamp: number): this {
		const range = this.VelaChart.getVisibleRange();
		if (!range) {
			this.VelaChart.setVisibleRange({ from: timestamp, to: timestamp + 60_000 });
			return this;
		}

		const width = range.to - range.from;
		const halfWidth = Math.max(width / 2, 30_000);

		this.VelaChart.setVisibleRange({
			from: timestamp - halfWidth,
			to: timestamp + halfWidth
		});

		return this;
	}

	getTotalRows(): number {
		return this.dataset[this._tsColumn]?.length ?? 0;
	}

	getLoadedDimensions(): string[] {
		return this._ohlcDims
			? [this._ohlcDims.open, this._ohlcDims.high, this._ohlcDims.low, this._ohlcDims.close]
			: [];
	}

	getActiveDimensions(): string[] {
		return this.getLoadedDimensions();
	}

	updateDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this {
		return this.updateDimensions(data, [dimName]);
	}

	updateDimensions(data: ChartDatasetFormatSimpleObject, dimNames: string[]): this {
		if (!this._ohlcDims) return this;

		if (data[this._tsColumn]) {
			this.dataset[this._tsColumn] = data[this._tsColumn];
		}
		for (const dimName of dimNames) {
			if (data[dimName]) {
				this.dataset[dimName] = data[dimName];
			}
		}

		this.VelaChart.setMarket({ data: this.toOHLCV(this._ohlcDims) });
		return this;
	}

	toggleMarkers(id: number, dimName: string, icon: string): this {
		const markers = this.markers.get(dimName);
		if (!markers) return this;

		const marker = markers.find((item) => item.id === id);
		if (!marker) return this;

		marker.visible = !marker.visible;
		if (marker.visible) {
			marker.shape = this.mapShape(icon);
		}
		this.syncMarksGroup();
		return this;
	}

	clearMarkers(): this {
		this.markers.clear();
		this.VelaChart.marks.clear();
		return this;
	}

	private toOHLCV(dims: OHLCDimensions): OHLCV[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const opens = this.dataset[dims.open] ?? [];
		const highs = this.dataset[dims.high] ?? [];
		const lows = this.dataset[dims.low] ?? [];
		const closes = this.dataset[dims.close] ?? [];

		const result: OHLCV[] = [];
		for (let i = 0; i < timestamps.length; i++) {
			const time = timestamps[i];
			const open = opens[i];
			const high = highs[i];
			const low = lows[i];
			const close = closes[i];
			if (time == null || open == null || high == null || low == null || close == null) {
				continue;
			}
			result.push({ time, open, high, low, close });
		}

		return result;
	}

	/**
	 * Vela has no price-anchored marker primitive in its public API — markers are
	 * approximated with `chart.marks`, a timeline lane above the time axis (a glyph
	 * per bar, opening a popup on click), not a glyph placed at the marker's value.
	 */
	private syncMarksGroup(): void {
		const marks: TimelineMark[] = [];

		for (const [dimName, markerList] of this.markers) {
			for (const marker of markerList) {
				if (!marker.visible) continue;
				marks.push({
					id: `${dimName}-${marker.id}`,
					time: marker.timestamp,
					title: marker.text,
					glyph: { shape: marker.shape, color: marker.color },
					group: CANDLESTICK_GROUP
				});
			}
		}

		this.VelaChart.marks.set(marks);
	}

	/**
	 * Vela's MarkShape has no arrow outlines — icon markers fall back to 'diamond' to
	 * stay visually distinct from the default 'circle'.
	 */
	private mapShape(icon?: string): MarkShape {
		if (icon === 'circle') return 'circle';
		if (icon === 'arrowUp' || icon === 'arrowDown') return 'diamond';
		return 'circle';
	}
}
