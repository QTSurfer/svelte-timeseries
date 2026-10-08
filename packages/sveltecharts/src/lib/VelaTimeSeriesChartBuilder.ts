import {
	registerNativeIndicator,
	type Vela,
	type OHLCV,
	type NativeIndicator,
	type NativeIndicatorContext,
	type SeriesPoint,
	type LineLikeSeries,
	type IndicatorHandle,
	type DrawingPolyline
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
	// Vela's native `circles`/`cross` point-marker kinds have no square/triangle shape at all
	// (see `customMarkerShape`'s doc comment) — 'square'/'arrowUp'/'arrowDown' are special-cased
	// into hand-built filled polylines so all four of the cross-engine-consistent icons
	// (circle/square/arrowUp/arrowDown — ChartMarkerPointOptions.icon's doc comment) render as
	// distinct shapes here too, not just in ECharts/Lightweight. Every other icon value
	// (including unset) still falls back to the plain circle, same as before this field existed.
	shape?: string;
};

const OVERLAY_INDICATOR_TYPE = 'qtsurfer-overlay';
const OVERLAY_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];

/**
 * Id of the `circles` series rendering marker "slot" `slot` — see `toMarkerSeriesPoints`'s doc
 * comment for why there can be more than one.
 */
function markerSeriesId(slot: number): string {
	return slot === 0 ? 'overlay-markers' : `overlay-markers-${slot}`;
}

/**
 * Which of the four cross-engine-consistent icons (`ChartMarkerPointOptions.icon`'s doc comment —
 * `circle` | `square` | `arrowUp` | `arrowDown`) needs a hand-built polygon instead of Vela's
 * native circle, and `null` for anything else (including unset — still the plain circle). Vela's
 * own point-marker primitive (`LineLikeKind`, the `kind` a `circles`/`cross` series carries) is
 * `'line' | 'area' | 'step' | 'histogram' | 'columns' | 'circles' | 'cross'` — no square or
 * triangle option at all, confirmed against Vela's own compiled source and type definitions, and
 * its separate `MarkShape` glyph system (`'circle' | 'square' | 'diamond' | 'pin'`, also
 * arrow-less) isn't wired into the native-indicator rendering pipeline in the first place (see
 * `emitOverlay`'s class-level doc comment on `MarkerSeries`). `circle` is excluded here on
 * purpose — it's the one shape Vela already draws natively, so it keeps using the `circles` slot
 * system instead of a hand-built square-ish quad.
 */
function customMarkerShape(shape: string | undefined): 'square' | 'arrowUp' | 'arrowDown' | null {
	if (shape === 'square' || shape === 'arrowUp' || shape === 'arrowDown') return shape;
	return null;
}

/** See `VelaTimeSeriesChartBuilder.polygonGeometry`. */
type PolygonGeometry = { height: number; halfWidth: number };

/**
 * First position in `barIndices` (ascending by time) whose timestamp is `>= t`, or `> t` when
 * `strict` — i.e. a lower or upper bound. Returns `barIndices.length` if none qualifies.
 */
function timeBound(
	barIndices: readonly number[],
	timestamps: readonly (number | null)[],
	t: number,
	strict = false
): number {
	let lo = 0;
	let hi = barIndices.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const value = timestamps[barIndices[mid]] as number;
		if (strict ? value <= t : value < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * How far each marker sharing both a dimension AND a bar with an earlier one is stacked away from
 * it — without it they'd carry the identical (bar, value) and the later one would hide the first.
 * Sized from the polygon height (a fraction of the visible price range, so roughly a fixed number
 * of screen pixels) rather than the bar's own high-low, which was 0 for a flat candle and subpixel
 * on narrow ones. 1.5x the polygon height clears both a polygon and a 16px-radius circle at
 * typical chart heights, and grows with `dupIndex` so further duplicates keep stacking.
 */
function duplicateMarkerOffset(geometry: PolygonGeometry, dupIndex: number): number {
	return geometry.height * 1.5 * dupIndex;
}

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
let pendingHooks: OverlayHooks | null = null;

type OverlayHooks = {
	onReady: (ctx: NativeIndicatorContext) => void;
	onViewport: () => void;
};

/**
 * Registers the (single, module-level) native-indicator TYPE every VelaTimeSeriesChartBuilder
 * instance adds to its own chart. `registerNativeIndicator` registers a TYPE globally, not a
 * per-chart instance — but `chart.addNativeIndicator` still mints one NativeIndicator instance
 * per chart (single-instance type, no `multiInstance`), each wired to that particular builder's
 * hooks via `pendingHooks`. This is safe with multiple Vela charts on one page.
 *
 * `reactsToViewport: true` makes the orchestrator call `onViewport` on this instance once a
 * zoom/pan settles (it's debounced in `onViewportChange`, not per frame) — the builder uses that
 * to re-size its hand-built marker polygons, see `onViewportSettled`.
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
		reactsToViewport: true,
		inputsSchema: () => [],
		defaultInputs: () => ({}),
		create: (): NativeIndicator => new OverlayNativeIndicator(pendingHooks ?? undefined)
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
	constructor(private readonly hooks?: OverlayHooks) {}

	start(ctx: NativeIndicatorContext): void {
		this.hooks?.onReady(ctx);
	}

	onBars(): void {}
	onViewport(): void {
		this.hooks?.onViewport();
	}
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
	// Cached result of retainedBarIndices, invalidated by invalidateBarIndices() whenever the
	// OHLC data actually changes. Recomputing it on every emitOverlay() — including pure marker
	// mutations (addMarkerPoint/toggleMarkers/clearMarkers) that never touch OHLC data — was an
	// O(dataset) scan on every single marker click.
	private cachedBarIndices: number[] | null = null;
	// Cached toSeriesPoints() result per extra dimension, invalidated alongside cachedBarIndices
	// (a dimension's alignment depends on the retained bar set) and whenever that dimension's own
	// data is replaced (updateDimensions). A marker-only mutation touches neither, so it reuses
	// every line's cached points instead of rebuilding all of them just to redraw markers.
	private seriesPointsCache = new Map<string, SeriesPoint[]>();
	// Persistent marker "slot" buffers (see toMarkerSeriesPoints), reused across emits instead of
	// reallocating `slotCount * barIndices.length` fresh point objects on every marker mutation.
	// Invalidated (emptied) alongside cachedBarIndices, since each buffer's length and each
	// point's `time` depend on the retained bar set.
	private markerSlotBuffers: SeriesPoint[][] = [];
	// Exactly which (slot, position) cells currently carry a real marker value, so the next
	// toMarkerSeriesPoints call knows precisely which cells to clear instead of scanning or
	// resetting every cell in every buffer.
	private occupiedMarkerCells: { slot: number; position: number }[] = [];
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
	// Whether the last emit carried any square/triangle polylines — see onViewportSettled.
	private hasPolygonMarkers = false;

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
		pendingHooks = {
			onReady: (ctx) => {
				this.overlayCtx = ctx;
				this.remounting = false;
				this.emitOverlay();
			},
			onViewport: () => this.onViewportSettled()
		};
		try {
			this.overlayHandle = this.VelaChart.addNativeIndicator(OVERLAY_INDICATOR_TYPE);
		} finally {
			pendingHooks = null;
		}
	}

	/**
	 * Square/triangle markers are data-space polylines sized from the visible range at emit
	 * time (`polygonGeometry`), so after a zoom/pan they'd keep their old
	 * data-space size and grow or shrink on screen. Re-emitting once the viewport settles
	 * recomputes them against the new range. Skipped when the last emit had no polygons — circles
	 * are already sized in screen pixels by Vela itself and need nothing here.
	 */
	private onViewportSettled(): void {
		if (this.hasPolygonMarkers) this.emitOverlay();
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
		this.invalidateBarIndices();

		// Vela's own default view after setMarket doesn't fit the loaded data — it can leave dead
		// space on one side rather than framing every bar, unlike lightweight-charts'
		// `timeScale().fitContent()` (called the same way, right after `setData`, in
		// `LightweightTimeSeriesChartBuilder`'s own setCandlestickSeries). `goToZoom(0, 100)`
		// spans the full loaded time range the same way, so all three engines open on a sensibly
		// framed chart instead of only two of them. `setMarket` returns `Promise<void>` — calling
		// `goToZoom` synchronously right after it, like a first attempt at this fix did, raced
		// ahead of Vela actually applying the new market data and set the visible range against
		// its still-empty prior state, leaving the chart permanently blank. Chaining onto the
		// returned promise instead waits for that to land.
		void this.VelaChart.setMarket({ data: this.toOHLCV(dims) }).then(() => this.goToZoom(0, 100));
		this.emitOverlay();

		return this;
	}

	addDimension(data: ChartDatasetFormatSimpleObject, dimName: string): this {
		this.dataset[dimName] = data[dimName];
		this.seriesPointsCache.delete(dimName);
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
			visible: true,
			shape: options?.icon
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
				this.seriesPointsCache.delete(dimName);
			}
		}

		if (this._ohlcDims && dimNames.some((d) => this.isOHLCDimension(d))) {
			this.invalidateBarIndices();
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

	/**
	 * Dataset indices that make it into the chart's actual OHLCV bars — the same
	 * completeness filter `toOHLCV` applies (all four OHLC components non-null, plus a
	 * non-null time). Vela's native renderer treats every indicator's line/marker `points`
	 * array as INDEX-ALIGNED with the chart's own bar array: `points[i - offset]` is read
	 * for chart bar `i` with no time lookup at all (see `emitPointMarkers`/`emitPolyline`
	 * and `DrawingScene.offsetOf`'s doc comment — "chart bar index its index-aligned
	 * payloads count from" — in the compiled source; our overlay never calls
	 * `setAnchorOffset`, so its offset is always 0). An overlay payload that isn't built
	 * over this exact same retained set — same length, same order — silently renders at
	 * the wrong bar past the first gap, or at the wrong bar entirely for a sparse array.
	 */
	private retainedBarIndices(dims: OHLCDimensions): number[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const opens = this.dataset[dims.open] ?? [];
		const highs = this.dataset[dims.high] ?? [];
		const lows = this.dataset[dims.low] ?? [];
		const closes = this.dataset[dims.close] ?? [];

		const indices: number[] = [];
		for (let i = 0; i < timestamps.length; i++) {
			if (
				timestamps[i] == null ||
				opens[i] == null ||
				highs[i] == null ||
				lows[i] == null ||
				closes[i] == null
			) {
				continue;
			}
			indices.push(i);
		}
		return indices;
	}

	/** Cached `retainedBarIndices` — see `invalidateBarIndices` for when it's recomputed. */
	private getBarIndices(): number[] {
		if (this.cachedBarIndices == null) {
			this.cachedBarIndices = this._ohlcDims ? this.retainedBarIndices(this._ohlcDims) : [];
		}
		return this.cachedBarIndices;
	}

	/**
	 * Clears the cached bar-index set, every cached line's points, and the persistent marker-slot
	 * buffers, since all three depend on which bars are retained (a buffer's length and each of
	 * its points' fixed `time` are only valid for the bar set they were built from). Called
	 * whenever the OHLC data actually changes (setCandlestickSeries, updateDimensions touching an
	 * OHLC dimension) — never for a pure marker mutation, which is exactly the case that was
	 * re-scanning/reallocating everything for no reason.
	 */
	private invalidateBarIndices(): void {
		this.cachedBarIndices = null;
		this.seriesPointsCache.clear();
		this.markerSlotBuffers = [];
		this.occupiedMarkerCells = [];
	}

	/** Cached `toSeriesPoints` per dimension — see `invalidateBarIndices`/`updateDimensions`. */
	private getSeriesPoints(dimName: string, barIndices: readonly number[]): SeriesPoint[] {
		const cached = this.seriesPointsCache.get(dimName);
		if (cached) return cached;
		const points = this.toSeriesPoints(dimName, barIndices);
		this.seriesPointsCache.set(dimName, points);
		return points;
	}

	private toOHLCV(dims: OHLCDimensions): OHLCV[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const opens = this.dataset[dims.open] ?? [];
		const highs = this.dataset[dims.high] ?? [];
		const lows = this.dataset[dims.low] ?? [];
		const closes = this.dataset[dims.close] ?? [];

		return this.retainedBarIndices(dims).map((i) => ({
			time: timestamps[i] as number,
			open: opens[i] as number,
			high: highs[i] as number,
			low: lows[i] as number,
			close: closes[i] as number
		}));
	}

	/**
	 * Pushes every extra dimension and every visible marker (both as `LineLikeSeries` —
	 * markers as `kind: 'circles'`, see below) through the overlay native indicator's emit
	 * channel.
	 *
	 * Vela's native-indicator patch path (`modelToValuePatch`/`applyPatch` in its compiled
	 * source) only ever UPDATES a series's `points` for an id already present in the model
	 * from the indicator's LAST FULL MOUNT — it never re-reads that series's `visible` flag,
	 * and an `emit()` naming a series id that wasn't part of that mount is silently dropped
	 * (patch has no add/remove path). It DOES correctly replace `points` wholesale for an
	 * already-known id, content and length included — so once a series has been mounted once,
	 * later point-content changes (new values, a line's values changing, which marker sits at
	 * which bar) reach the chart through an ordinary emit with no remount needed. So whenever
	 * the SET of series ids changes or a line's `visible` flips — not its points — this removes
	 * and re-adds the overlay indicator (`handle.remove()` + `addNativeIndicator` again) instead
	 * of emitting in place: a freshly (re-)added indicator's first `applyModel` always takes the
	 * full `mountIndicator` path (no `renderHandle` yet), never the patch path, so this
	 * sidesteps the patch's id-matching/visible gaps entirely rather than relying on a
	 * same-instance remount signal.
	 *
	 * The remount is async (a fresh `addNativeIndicator` only calls `start(ctx)` after Vela's
	 * own readiness wait — see `ensureOverlayRegistered`), so `overlayCtx`/`overlayHandle` are
	 * unavailable for the duration: further mutations during that window are captured by
	 * `dataset`/`extraDimensions`/`markers` as usual and simply re-run `emitOverlay()` once the
	 * new context arrives (via `mountOverlayIndicator`'s `onReady` hook), so nothing
	 * is lost — only the LAST state before the callback fires is what gets emitted.
	 */
	private emitOverlay(): void {
		if (this.remounting) return;
		if (!this.overlayCtx || !this.overlayHandle) return;

		// The exact same retained-bar set `toOHLCV` just built the chart's bars from — see
		// `retainedBarIndices`'s doc comment for why every payload below must share it.
		const barIndices = this.getBarIndices();

		const series: LineLikeSeries[] = this.extraDimensions.map((dimName, index) => ({
			id: `overlay-line-${dimName}`,
			title: dimName,
			// `paneId` is informational only — the orchestrator's placeModel() unconditionally
			// overwrites it from the model's own resolved pane. This overlay indicator's
			// descriptor already sets `overlay: true` (see ensureOverlayRegistered), which
			// routePane() reads to route the whole model to the price pane on its own — so this
			// per-series `overlay: true` is redundant today, but it's the documented, correct
			// per-series escape hatch ("force_overlay → render on the price pane regardless of
			// the indicator's pane" — SeriesBase.overlay in Vela's own types) and costs nothing
			// to keep as a defensive belt-and-suspenders in case that ever changes.
			paneId: 'price',
			overlay: true,
			kind: 'line',
			visible: this.selected[dimName] ?? true,
			points: this.getSeriesPoints(dimName, barIndices),
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
		// for the ECharts/Lightweight builders. Each "slot" below is its own `circles` series so
		// that markers landing on the same bar don't overwrite each other — see
		// `toMarkerSeriesPoints`'s doc comment. `'square'`/`'arrowUp'`/`'arrowDown'` markers skip
		// this entirely and come back as hand-built `polylines` instead (see
		// `buildSquarePolyline`/`buildTrianglePolyline`) — Vela's point-marker kinds have neither
		// shape to ask for natively.
		const { circleSlots, polygons } = this.toMarkerSeriesPoints(barIndices);
		this.hasPolygonMarkers = polygons.length > 0;
		const markerSeriesList: LineLikeSeries[] = circleSlots.map((points, slot) => ({
			id: markerSeriesId(slot),
			title: slot === 0 ? 'Markers' : `Markers (overlap ${slot + 1})`,
			// See the `series` block above for why `overlay: true` (not `paneId`) is what
			// actually routes this onto the price pane.
			paneId: 'price',
			overlay: true,
			kind: 'circles',
			points,
			// `emitPointMarkers` in Vela's compiled source reads `style.width` as the circle's
			// RADIUS in literal screen pixels (`Math.max(1.5, s.style.width)`, passed straight to
			// its canvas circle draw call) — unlike the hand-built square/triangle polylines
			// (`buildSquarePolyline`/`buildTrianglePolyline`), which are sized in DATA space and
			// so need `polygonGeometry`'s fraction-of-visible-range math to stay
			// a consistent pixel size across zoom levels. A circle marker gets that same
			// consistency for free since its size is already a direct, zoom-independent pixel
			// value — it just needs to roughly match the other shapes' rendered size. The old
			// value (5, a 10px-diameter dot) was tuned before those shapes existed and reads as
			// tiny next to a ~40px-wide square/triangle.
			style: { color: '#000000', width: 16, lineStyle: 'solid' }
		}));

		// occupiedMarkerCells is maintained by toMarkerSeriesPoints as it goes — checking its
		// length is O(1), unlike re-scanning every point of every slot just to answer "are there
		// any markers at all".
		const hasMarkers = this.occupiedMarkerCells.length > 0;
		const allSeries = hasMarkers ? [...series, ...markerSeriesList] : series;

		// The markers series is now a plain `circles` LineLikeSeries like any extra dimension —
		// once its id is part of a mount, the patch path DOES correctly replace its `points` on
		// every later emit (patch only fails to add/remove a series or re-read `visible`, not to
		// update a known series's points — see emitOverlay's class-level doc comment). So the
		// fingerprint only needs each series's id + visible (which series EXIST and whether each
		// line is shown), not their point CONTENT: hashing the resolved points would be
		// proportional to the dataset size (one entry per bar) on every single mutation, for data
		// that already flows through the patch path correctly without a remount.
		const fingerprint = JSON.stringify(
			allSeries.map((s) => ({ id: s.id, visible: s.visible ?? true }))
		);

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
		// Unlike `series`, `applyPatch` replaces `model.polylines` wholesale on every patch (no
		// per-id merge) — squares/triangles never need the remount dance circles do, so they're
		// just passed as-is on every ordinary emit, remount or not.
		this.overlayCtx.emit({ series: allSeries, polylines: polygons });
	}

	/**
	 * One point per retained OHLC bar (`barIndices`, same length and order as the chart's own
	 * bars — see `retainedBarIndices`), `null`-valued wherever this dimension itself has no
	 * value at that bar. A row whose OHLC was incomplete (so it has no bar to align to at all)
	 * has no corresponding entry here, even if this dimension has a value there — there is no
	 * valid index to place it at.
	 */
	private toSeriesPoints(dimName: string, barIndices: readonly number[]): SeriesPoint[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dimName] ?? [];

		return barIndices.map((i) => ({
			time: timestamps[i] as number,
			value: values[i] ?? null
		}));
	}

	/**
	 * One or more persistent "slot" buffers (see `markerSlotBuffers`), each one point per
	 * retained OHLC bar (same contract as `toSeriesPoints`), `null`-valued except where a visible
	 * marker was placed. Markers are sourced separately from the loaded series (e.g. a DuckDB
	 * `markers` table), so a marker's timestamp has no guarantee of landing exactly on a retained
	 * bar — `findClosestBar` resolves the nearest one that actually has a non-null value for the
	 * marker's dimension, skipping both a null-valued bar at that row and a bar with no entry at
	 * all (an incomplete-OHLC row, absent from `barIndices`).
	 *
	 * A single slot array can only carry ONE value per bar, so when several CIRCLE markers resolve
	 * to the SAME bar, each one after the first goes into its own additional slot instead of
	 * overwriting the one before it — every visible circle marker always gets a point somewhere.
	 * The common case (no collisions) returns exactly one slot. Two markers in DIFFERENT slots but
	 * sharing the same dimension AND bar would otherwise still land on the exact same (time,
	 * value) — Vela paints circles in series order, so the later one would fully cover the earlier
	 * one despite being a separate series. Every such duplicate past the first is nudged by
	 * `duplicateMarkerOffset` so it's visually distinguishable instead of hidden.
	 *
	 * `'square'`/`'arrowUp'`/`'arrowDown'` markers (see `customMarkerShape`) don't go through this
	 * slot system at all — each becomes its own independently-addressable `DrawingPolyline`,
	 * returned separately, so they never compete for a slot or need the collision workaround
	 * circles do.
	 *
	 * Slot buffers are reused across calls (grown when `slotCount` increases, otherwise left
	 * as-is) and only the cells that actually changed are touched — `occupiedMarkerCells` records
	 * exactly which ones to clear first — instead of allocating `slotCount * barIndices.length`
	 * fresh point objects on every marker mutation. Polygons are cheap to rebuild fresh each call
	 * (one per marker, not one per bar) so they skip that optimization entirely.
	 */
	private toMarkerSeriesPoints(barIndices: readonly number[]): {
		circleSlots: SeriesPoint[][];
		polygons: DrawingPolyline[];
	} {
		const timestamps = this.dataset[this._tsColumn] ?? [];

		const resolved: { dimName: string; marker: MarkerState; position: number }[] = [];
		for (const [dimName, markers] of this.markers) {
			for (const marker of markers) {
				if (!marker.visible) continue;
				const position = this.findClosestBar(dimName, marker.timestamp, barIndices);
				if (position == null) continue;
				resolved.push({ dimName, marker, position });
			}
		}

		const byPosition = new Map<number, typeof resolved>();
		for (const entry of resolved) {
			const group = byPosition.get(entry.position) ?? [];
			group.push(entry);
			byPosition.set(entry.position, group);
		}

		let slotCount = 1;
		for (const group of byPosition.values()) {
			const circleCount = group.filter(
				(entry) => customMarkerShape(entry.marker.shape) == null
			).length;
			slotCount = Math.max(slotCount, circleCount);
		}

		while (this.markerSlotBuffers.length < slotCount) {
			this.markerSlotBuffers.push(
				barIndices.map((i) => ({ time: timestamps[i] as number, value: null }))
			);
		}

		for (const { slot, position } of this.occupiedMarkerCells) {
			const point = this.markerSlotBuffers[slot][position];
			point.value = null;
			point.color = undefined;
		}

		// Computed at most once per emit, and only if a polygon or a stacked duplicate needs it —
		// it scans the visible bars' high/low, which shouldn't repeat per marker.
		let geometry: PolygonGeometry | null = null;
		const getGeometry = () => (geometry ??= this.polygonGeometry(barIndices));

		const polygons: DrawingPolyline[] = [];
		const nextOccupied: { slot: number; position: number }[] = [];
		for (const group of byPosition.values()) {
			const sameDimCount = new Map<string, number>();
			let circleSlot = 0;
			group.forEach((entry) => {
				const dupIndex = sameDimCount.get(entry.dimName) ?? 0;
				sameDimCount.set(entry.dimName, dupIndex + 1);

				const i = barIndices[entry.position];
				const baseValue = this.dataset[entry.dimName]?.[i] as number;
				const value =
					dupIndex === 0 ? baseValue : baseValue + duplicateMarkerOffset(getGeometry(), dupIndex);

				const shape = customMarkerShape(entry.marker.shape);
				if (shape === 'arrowUp' || shape === 'arrowDown') {
					polygons.push(
						this.buildTrianglePolyline(entry.dimName, entry.marker, i, value, getGeometry())
					);
					return;
				}
				if (shape === 'square') {
					polygons.push(
						this.buildSquarePolyline(entry.dimName, entry.marker, i, value, getGeometry())
					);
					return;
				}

				const slot = circleSlot++;
				const point = this.markerSlotBuffers[slot][entry.position];
				point.value = value;
				point.color = entry.marker.color;
				nextOccupied.push({ slot, position: entry.position });
			});
		}
		this.occupiedMarkerCells = nextOccupied;

		return { circleSlots: this.markerSlotBuffers.slice(0, slotCount), polygons };
	}

	/**
	 * A filled triangle approximating an up/down arrow — anchored AT the marker's own dimension
	 * value, centered the same way a circle or square marker is (an up arrow's apex sits above
	 * `value`, a down arrow's apex sits below it, each by half the shape's height, so `value`
	 * itself is the vertical midpoint). This matches how the ECharts/Lightweight builders place
	 * every marker shape — including arrows — exactly on the plotted dimension (e.g. `sma`), so
	 * all three engines agree on WHERE a marker sits, not just what icon it uses. `dupIndex`-based
	 * separation for same-bar/same-dimension duplicates is already baked into `value` by the
	 * caller (`toMarkerSeriesPoints`'s `duplicateMarkerOffset`), the same mechanism circles and
	 * squares use, so this needs no separate stacking logic of its own. Built from
	 * `NativeIndicatorOutput.polylines` (`closed: true` + `fillColor`), the one Vela primitive
	 * expressive enough for an arbitrary shape — `LineLikeKind` only ever offers `'circles'` or
	 * `'cross'` (see `customMarkerShape`'s doc comment).
	 *
	 * Unlike `series`, `applyPatch` replaces `model.polylines` wholesale on every patch (no
	 * per-id merge, see `emitOverlay`'s doc comment) — so, unlike circles, a triangle appearing,
	 * moving, or disappearing never needs the remove+re-add remount dance.
	 */
	private buildTrianglePolyline(
		dimName: string,
		marker: MarkerState,
		barIndex: number,
		value: number,
		{ height, halfWidth }: PolygonGeometry
	): DrawingPolyline {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const time = timestamps[barIndex] as number;
		const halfHeight = height / 2;
		const up = marker.shape === 'arrowUp';
		// Computed as `value ± halfHeight` (not `tipPrice ∓ height`) so this lands on the exact
		// same float as the square's own `value ± halfHeight` — the two shapes share a value and
		// a halfHeight, and should share their top/bottom edges bit-for-bit too.
		const tipPrice = up ? value + halfHeight : value - halfHeight;
		const basePrice = up ? value - halfHeight : value + halfHeight;

		return {
			id: `overlay-triangle-${dimName}-${marker.id}`,
			paneId: 'price',
			overlay: true,
			points: [
				{ xloc: 'bar_time', x: time, price: tipPrice },
				{ xloc: 'bar_time', x: time - halfWidth, price: basePrice },
				{ xloc: 'bar_time', x: time + halfWidth, price: basePrice }
			],
			curved: false,
			closed: true,
			fillColor: marker.color,
			lineColor: marker.color,
			lineWidth: 1,
			lineStyle: 'solid',
			arrowLeft: false,
			arrowRight: false
		};
	}

	/**
	 * A filled square — unlike the triangle, anchored AT the marker's own `value` (same anchor a
	 * circle marker uses), since a square isn't a directional buy/sell-style signal the way an
	 * arrow is; it's just a different silhouette for the same "sitting on the line" marker circles
	 * already render. `dupIndex` nudges `value` itself (via the caller's `duplicateMarkerOffset`,
	 * same as circles) rather than growing a separate gap, so same-bar/same-dimension duplicates
	 * stay visually consistent with how circle duplicates already separate. Built from
	 * `NativeIndicatorOutput.polylines` for the same reason `buildTrianglePolyline` is — see its
	 * doc comment and `customMarkerShape`'s.
	 */
	private buildSquarePolyline(
		dimName: string,
		marker: MarkerState,
		barIndex: number,
		value: number,
		{ height, halfWidth }: PolygonGeometry
	): DrawingPolyline {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const time = timestamps[barIndex] as number;
		const halfHeight = height / 2;

		return {
			id: `overlay-square-${dimName}-${marker.id}`,
			paneId: 'price',
			overlay: true,
			points: [
				{ xloc: 'bar_time', x: time - halfWidth, price: value + halfHeight },
				{ xloc: 'bar_time', x: time + halfWidth, price: value + halfHeight },
				{ xloc: 'bar_time', x: time + halfWidth, price: value - halfHeight },
				{ xloc: 'bar_time', x: time - halfWidth, price: value - halfHeight }
			],
			curved: false,
			closed: true,
			fillColor: marker.color,
			lineColor: marker.color,
			lineWidth: 1,
			lineStyle: 'solid',
			arrowLeft: false,
			arrowRight: false
		};
	}

	/**
	 * Size of a hand-built marker polygon in data space: `height` in price units, `halfWidth` in
	 * ms. Both are fractions of the CURRENTLY VISIBLE extent — `halfWidth` of the visible time
	 * range, `height` of the high-low range of only the bars inside it — because Vela autoscales
	 * each axis to what's on screen, and the two axes' px-per-unit drift at different rates when
	 * zooming. Sizing off the full dataset (an earlier version) only looked right at the default
	 * zoom and stretched or flattened elsewhere; rebasing both on the visible extent cancels each
	 * axis's zoom factor, keeping the rendered pixel size (and aspect ratio) roughly constant —
	 * like `symbolSize` on the other engines. Kept current across zoom/pan by
	 * `onViewportSettled`.
	 *
	 * Visible bars are found by binary search on `barIndices` (ascending by time), so the cost is
	 * proportional to what's on screen, not the dataset. Falls back to the full retained range,
	 * then to a fraction of the first close (never 0, which would draw nothing), and to an
	 * average-bar-interval width, when no visible range exists yet (pre-first-render).
	 */
	private polygonGeometry(barIndices: readonly number[]): PolygonGeometry {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const visible = this.VelaChart.getVisibleRange();
		const hasVisible = visible != null && visible.to > visible.from;

		let start = 0;
		let end = barIndices.length;
		if (hasVisible) {
			start = timeBound(barIndices, timestamps, visible.from);
			end = timeBound(barIndices, timestamps, visible.to, true);
		}

		let height = 0;
		if (this._ohlcDims) {
			const highs = this.dataset[this._ohlcDims.high] ?? [];
			const lows = this.dataset[this._ohlcDims.low] ?? [];
			let max = -Infinity;
			let min = Infinity;
			for (let p = start; p < end; p++) {
				const i = barIndices[p];
				const h = highs[i];
				const l = lows[i];
				if (h != null && h > max) max = h;
				if (l != null && l < min) min = l;
			}
			if (max > min) height = (max - min) * 0.045;
		}
		if (height === 0) {
			const close = this._ohlcDims
				? (this.dataset[this._ohlcDims.close]?.[barIndices[0]] ?? null)
				: null;
			height = Math.abs(close ?? 1) * 0.01 || 1;
		}

		let halfWidth: number;
		if (hasVisible) {
			halfWidth = (visible.to - visible.from) * 0.019;
		} else if (barIndices.length < 2) {
			halfWidth = 30_000;
		} else {
			const first = timestamps[barIndices[0]] as number;
			const last = timestamps[barIndices[barIndices.length - 1]] as number;
			halfWidth = ((last - first) / (barIndices.length - 1)) * 1.5;
		}

		return { height, halfWidth };
	}

	/**
	 * The position WITHIN `barIndices` (not a raw dataset index — directly usable as a
	 * `toMarkerSeriesPoints` array index) of the bar closest to `timestamp`, among bars where
	 * `dimName` has a non-null value. Restricted to `barIndices` rather than the raw dataset:
	 * only a retained bar has a valid render position at all, so the closest RAW row is not
	 * necessarily usable.
	 *
	 * `barIndices` is in ascending time order (same order as the dataset), so this binary-searches
	 * for the landing position and then expands outward only as far as needed: once a direction's
	 * candidate is farther from `timestamp` than the best found so far, time's monotonicity
	 * guarantees nothing further that way can be closer, so that side stops. This lands in
	 * O(log n) and only pays for a linear scan proportional to the width of a null-value gap
	 * around the landing position, instead of scanning every bar for every marker.
	 */
	private findClosestBar(
		dimName: string,
		timestamp: number,
		barIndices: readonly number[]
	): number | null {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dimName] ?? [];
		if (barIndices.length === 0) return null;

		let lo = 0;
		let hi = barIndices.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if ((timestamps[barIndices[mid]] as number) < timestamp) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}

		let bestPosition: number | null = null;
		let bestDiff = Number.POSITIVE_INFINITY;

		const consider = (position: number): number => {
			const i = barIndices[position];
			const diff = Math.abs((timestamps[i] as number) - timestamp);
			if (values[i] != null && diff < bestDiff) {
				bestDiff = diff;
				bestPosition = position;
			}
			return diff;
		};

		let left = lo - 1;
		let right = lo;
		while (left >= 0 || right < barIndices.length) {
			if (left >= 0) {
				const diff = consider(left);
				left = bestPosition != null && diff > bestDiff ? -1 : left - 1;
			}
			if (right < barIndices.length) {
				const diff = consider(right);
				right = bestPosition != null && diff > bestDiff ? barIndices.length : right + 1;
			}
		}

		return bestPosition;
	}
}
