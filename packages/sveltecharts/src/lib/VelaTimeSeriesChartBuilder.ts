import {
	registerNativeIndicator,
	type Vela,
	type OHLCV,
	type NativeIndicator,
	type NativeIndicatorContext,
	type SeriesPoint,
	type LineLikeSeries,
	type IndicatorHandle
} from '@luxalgo/vela';
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
	text?: string;
	visible: boolean;
};

const OVERLAY_INDICATOR_TYPE = 'qtsurfer-overlay';
const OVERLAY_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];
const MARKERS_LINE_ID = 'overlay-markers';

let overlayRegistered = false;

/**
 * Set immediately before each `chart.addNativeIndicator(OVERLAY_INDICATOR_TYPE)` call and
 * consumed by the descriptor's `create()` below. This works because Vela's orchestrator calls
 * `descriptor.create()` SYNCHRONOUSLY inside `addNativeIndicator` (confirmed against the
 * compiled source: `native: { instance: descriptor.create(), ... }` happens before the async
 * `startNativeIndicator` is even invoked) — so no two builders' constructors can interleave
 * between setting this and `create()` reading it, despite `registerNativeIndicator`'s type
 * registration being module-global rather than per-chart.
 */
let pendingOnReady: ((ctx: NativeIndicatorContext) => void) | null = null;

/**
 * Registers the (single, module-level) native-indicator TYPE every VelaTimeSeriesChartBuilder
 * instance adds to its own chart. `registerNativeIndicator` registers a TYPE globally, not a
 * per-chart instance — but `chart.addNativeIndicator` still mints one NativeIndicator instance
 * per chart (single-instance type, no `multiInstance`), each wired to that particular builder's
 * `onReady` via `pendingOnReady`. This is safe with multiple Vela charts on one page.
 *
 * `legend: false` keeps this out of Vela's own indicator legend/settings/remove UI — it exists
 * purely to give this builder an `emit` channel for the extra line/marker series the
 * TimeSeriesChartAdapter contract asks for (addDimension, addMarkerPoint, ...), which Vela's
 * public API otherwise has no direct way to add outside a native/scripted indicator.
 */
function ensureOverlayRegistered() {
	if (overlayRegistered) return;
	overlayRegistered = true;

	registerNativeIndicator({
		type: OVERLAY_INDICATOR_TYPE,
		title: 'QTSurfer overlay',
		paneHint: 'price',
		overlay: true,
		legend: false,
		multiInstance: false,
		inputsSchema: () => [],
		defaultInputs: () => ({}),
		create: (): NativeIndicator => new OverlayNativeIndicator(pendingOnReady ?? undefined)
	});
}

/**
 * The NativeIndicator instance backing one chart's overlay channel. It computes nothing itself —
 * `start` just hands its `NativeIndicatorContext` to the owning builder's `onReady` callback, so
 * the builder can call `ctx.emit(...)` on demand from addDimension / addMarkerPoint /
 * updateDimension(s), instead of Vela driving the compute. `start` runs after Vela's own async
 * readiness wait (see `startNativeIndicator` in the compiled source), so `overlayCtx` on the
 * builder is only available once that resolves — emits before then are silently skipped and
 * re-sent on the next mutation.
 */
class OverlayNativeIndicator implements NativeIndicator {
	constructor(private readonly onReady?: (ctx: NativeIndicatorContext) => void) {}

	start(ctx: NativeIndicatorContext): void {
		this.onReady?.(ctx);
	}

	onBars(): void {}
	onViewport(): void {}
	setInputs(): void {}
	suspend(): void {}
	resume(): void {}
	stop(): void {}
}

/**
 * Vela (`@luxalgo/vela`) renders a single OHLCV market as its base series. Extra line series and
 * markers (addDimension, addMarkerPoint) are added through a small always-on native indicator
 * (see `ensureOverlayRegistered`/`OverlayNativeIndicator`) that this builder owns per chart and
 * feeds directly with already-loaded data — no computation happens on Vela's side, it only
 * renders what this builder emits. Generic multi-series datasets without an OHLC base
 * (setDataset) are still not supported: Vela's market model always has exactly one base series.
 */
export class VelaTimeSeriesChartBuilder implements TimeSeriesChartAdapter {
	public VelaChart: Vela;
	private builderConfig: ConfigBuilder = {
		externalManagerLegend: false
	};
	private dataset: ChartDatasetFormatSimpleObject = {};
	private _tsColumn = '_ts';
	private _ohlcDims: OHLCDimensions | null = null;
	private selected: Record<string, boolean> = {};
	private extraDimensions: string[] = [];
	private markers = new Map<string, MarkerState[]>();
	private overlayCtx: NativeIndicatorContext | null = null;
	private overlayHandle: IndicatorHandle | null = null;
	// A fingerprint of the LAST emit's series (ids + visibility + marker identities) — see
	// emitOverlay's structural-change check.
	private lastOverlayFingerprint = '';
	// True between removing the overlay indicator and its replacement's context becoming ready
	// — blocks emitOverlay from running (there's no live overlayCtx/overlayHandle to use) while
	// still letting dataset/extraDimensions/markers mutations accumulate normally.
	private remounting = false;
	// False until the overlay indicator's FIRST emit has gone out. That first emit always takes
	// Vela's full mountIndicator path on its own (no renderHandle exists yet) — skip the
	// remove+re-add cycle for it, it would just be a redundant extra round trip.
	private overlayEverEmitted = false;

	constructor(instance: Vela, builderConfig?: ConfigBuilder) {
		this.VelaChart = instance;
		this.builderConfig = { ...this.builderConfig, ...builderConfig };

		ensureOverlayRegistered();
		this.mountOverlayIndicator();
	}

	/**
	 * Adds (or re-adds, after a remove()) the overlay native indicator to this chart and wires
	 * its NativeIndicatorContext to this builder once Vela's async readiness resolves.
	 */
	private mountOverlayIndicator(): void {
		pendingOnReady = (ctx) => {
			this.overlayCtx = ctx;
			this.remounting = false;
			this.emitOverlay();
		};
		try {
			this.overlayHandle = this.VelaChart.addNativeIndicator(OVERLAY_INDICATOR_TYPE);
		} finally {
			pendingOnReady = null;
		}
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
		this.emitOverlay();

		return this;
	}

	addDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this {
		this.dataset[dimName] = data[dimName];
		if (!this.extraDimensions.includes(dimName)) {
			this.extraDimensions.push(dimName);
		}
		this.selected[dimName] = true;

		this.emitOverlay();
		return this;
	}

	build(): this {
		return this;
	}

	addMarkerPoint(id: number, data: ChartMarkerPoint, options?: ChartMarkerPointOptions): this {
		const markerState: MarkerState = {
			id,
			timestamp: data.timestamp,
			color: options?.color ?? '#000000',
			text: data.name,
			visible: true
		};

		const markers = this.markers.get(data.dimName) ?? [];
		markers.push(markerState);
		this.markers.set(data.dimName, markers);
		this.emitOverlay();
		return this;
	}

	getLegendStatus(): Record<string, boolean> {
		return this.selected;
	}

	toggleLegend(column: string): this {
		if (!column) return this;
		this.selected[column] = !(this.selected[column] ?? false);
		this.emitOverlay();
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
		const ohlc = this._ohlcDims
			? [this._ohlcDims.open, this._ohlcDims.high, this._ohlcDims.low, this._ohlcDims.close]
			: [];
		return [...ohlc, ...this.extraDimensions];
	}

	getActiveDimensions(): string[] {
		return this.getLoadedDimensions();
	}

	updateDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this {
		return this.updateDimensions(data, [dimName]);
	}

	updateDimensions(data: ChartDatasetFormatSimpleObject, dimNames: string[]): this {
		if (data[this._tsColumn]) {
			this.dataset[this._tsColumn] = data[this._tsColumn];
		}
		for (const dimName of dimNames) {
			if (data[dimName]) {
				this.dataset[dimName] = data[dimName];
			}
		}

		if (this._ohlcDims && dimNames.some((d) => this.isOHLCDimension(d))) {
			this.VelaChart.setMarket({ data: this.toOHLCV(this._ohlcDims) });
		}

		this.emitOverlay();
		return this;
	}

	toggleMarkers(id: number, dimName: string, _icon: string): this {
		const markers = this.markers.get(dimName);
		if (!markers) return this;

		const marker = markers.find((item) => item.id === id);
		if (!marker) return this;

		marker.visible = !marker.visible;
		this.emitOverlay();
		return this;
	}

	clearMarkers(): this {
		this.markers.clear();
		this.emitOverlay();
		return this;
	}

	private isOHLCDimension(dim: string): boolean {
		if (!this._ohlcDims) return false;
		return (
			dim === this._ohlcDims.open ||
			dim === this._ohlcDims.high ||
			dim === this._ohlcDims.low ||
			dim === this._ohlcDims.close
		);
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
	 * Pushes every extra dimension (as a line series) and every visible marker (as a marker
	 * series) through the overlay native indicator's emit channel.
	 *
	 * Vela's native-indicator patch path (`modelToValuePatch`/`applyPatch` in its compiled
	 * source) only ever UPDATES a series's `points` for an id already present in the model
	 * from the indicator's LAST FULL MOUNT — it never re-reads that series's `visible` flag,
	 * an `emit()` naming a NEW id is silently dropped, and `MarkerSeries` isn't patched at all
	 * (only `line*`/`candle`/`bar` kinds are, so a marker add/remove never reaches the chart
	 * through a plain emit). So whenever anything other than a line's `points` changes — series
	 * ids added/removed, a line's visibility flipping, or the marker set changing at all — this
	 * removes and re-adds the overlay indicator (`handle.remove()` + `addNativeIndicator` again)
	 * instead of emitting in place: a freshly (re-)added indicator's first `applyModel` always
	 * takes the full `mountIndicator` path (no `renderHandle` yet), never the patch path, so
	 * this sidesteps the patch's id-matching/visible/markers gaps entirely rather than relying
	 * on a same-instance remount signal.
	 *
	 * The remount is async (a fresh `addNativeIndicator` only calls `start(ctx)` after Vela's
	 * own readiness wait — see `ensureOverlayRegistered`), so `overlayCtx`/`overlayHandle` are
	 * unavailable for the duration: further mutations during that window are captured by
	 * `dataset`/`extraDimensions`/`markers` as usual and simply re-run `emitOverlay()` once the
	 * new context arrives (via `mountOverlayIndicator`'s `pendingOnReady` callback), so nothing
	 * is lost — only the LAST state before the callback fires is what gets emitted.
	 */
	private emitOverlay(): void {
		if (this.remounting) return;
		if (!this.overlayCtx || !this.overlayHandle) return;

		const series: LineLikeSeries[] = this.extraDimensions.map((dimName, index) => ({
			id: `overlay-line-${dimName}`,
			title: dimName,
			paneId: 'price',
			kind: 'line',
			visible: this.selected[dimName] ?? true,
			points: this.toSeriesPoints(dimName),
			style: {
				color: OVERLAY_COLORS[index % OVERLAY_COLORS.length],
				width: 1,
				lineStyle: 'solid'
			}
		}));

		// Vela's native renderer has no separate pipeline for `kind: 'markers'` (`MarkerSeries`)
		// — `emitSeries` only handles `candle`/`bar` and isLineLikeSeries kinds, so a
		// MarkerSeries silently paints nothing. A price-anchored marker is instead a
		// `LineLikeSeries` with `kind: 'circles'`: `emitPointMarkers` paints one point per
		// series entry at (time, value), which is exactly what markPoint/createSeriesMarkers do
		// for the ECharts/Lightweight builders.
		const markerPoints = this.toMarkerSeriesPoints();
		const markerSeries: LineLikeSeries = {
			id: MARKERS_LINE_ID,
			title: 'Markers',
			paneId: 'price',
			kind: 'circles',
			points: markerPoints,
			style: { color: '#000000', width: 5, lineStyle: 'solid' }
		};

		const allSeries = markerPoints.length ? [...series, markerSeries] : series;

		// Everything except each line's `points` (which the patch path DOES update correctly) —
		// id + visible per line, plus a full marker snapshot since markers are never patched.
		const fingerprint = JSON.stringify({
			lines: series.map((s) => ({ id: s.id, visible: s.visible })),
			markers: markerPoints
		});

		const changed = fingerprint !== this.lastOverlayFingerprint;
		this.lastOverlayFingerprint = fingerprint;

		if (changed && this.overlayEverEmitted) {
			this.remounting = true;
			this.overlayCtx = null;
			this.overlayHandle.remove();
			this.overlayHandle = null;
			// mountOverlayIndicator's onReady callback clears `remounting` and re-enters
			// emitOverlay once the fresh indicator's context is ready, re-reading current state
			// (dataset/extraDimensions/markers/selected) at that point — so this remount doesn't
			// need to (and, with overlayCtx cleared, can't) emit itself synchronously here.
			this.mountOverlayIndicator();
			return;
		}

		this.overlayEverEmitted = true;
		this.overlayCtx.emit({ series: allSeries });
	}

	private toSeriesPoints(dimName: string): SeriesPoint[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dimName] ?? [];

		const points: SeriesPoint[] = [];
		for (let i = 0; i < timestamps.length; i++) {
			const time = timestamps[i];
			if (time == null) continue;
			points.push({ time, value: values[i] ?? null });
		}
		return points;
	}

	/**
	 * Resolves each visible marker to the actual value of its dimension at its timestamp — the
	 * same anchor point markPoint (ECharts) and createSeriesMarkers (Lightweight) place their
	 * marker at, so it renders sitting on the line/candle it annotates instead of an arbitrary
	 * position. A marker whose dimension has no matching or non-null value at that exact
	 * timestamp is skipped (nothing to anchor it to).
	 */
	private toMarkerSeriesPoints(): SeriesPoint[] {
		const points: SeriesPoint[] = [];
		for (const [dimName, markers] of this.markers) {
			for (const marker of markers) {
				if (!marker.visible) continue;
				const value = this.findValueAt(dimName, marker.timestamp);
				if (value == null) continue;
				points.push({ time: marker.timestamp, value, color: marker.color });
			}
		}
		return points;
	}

	private findValueAt(dimName: string, timestamp: number): number | null {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dimName] ?? [];
		const index = timestamps.indexOf(timestamp);
		if (index === -1) return null;
		return values[index] ?? null;
	}
}
