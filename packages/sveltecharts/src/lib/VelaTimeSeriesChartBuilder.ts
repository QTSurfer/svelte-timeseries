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

/**
 * Id of the `circles` series rendering marker "slot" `slot` — see `toMarkerSeriesPoints`'s doc
 * comment for why there can be more than one.
 */
function markerSeriesId(slot: number): string {
	return slot === 0 ? 'overlay-markers' : `overlay-markers-${slot}`;
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
		this.invalidateBarIndices();

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
	 * Clears the cached bar-index set and every cached line's points, since both depend on which
	 * bars are retained. Called whenever the OHLC data actually changes (setCandlestickSeries,
	 * updateDimensions touching an OHLC dimension) — never for a pure marker mutation, which is
	 * exactly the case that was re-scanning the whole dataset for no reason.
	 */
	private invalidateBarIndices(): void {
		this.cachedBarIndices = null;
		this.seriesPointsCache.clear();
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
	 * new context arrives (via `mountOverlayIndicator`'s `pendingOnReady` callback), so nothing
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
			paneId: 'price',
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
		// `toMarkerSeriesPoints`'s doc comment.
		const markerSlots = this.toMarkerSeriesPoints(barIndices);
		const markerSeriesList: LineLikeSeries[] = markerSlots.map((points, slot) => ({
			id: markerSeriesId(slot),
			title: slot === 0 ? 'Markers' : `Markers (overlap ${slot + 1})`,
			paneId: 'price',
			kind: 'circles',
			points,
			style: { color: '#000000', width: 5, lineStyle: 'solid' }
		}));

		const hasMarkers = markerSlots.some((points) => points.some((p) => p.value != null));
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
		this.overlayCtx.emit({ series: allSeries });
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
	 * One or more "slots", each one point per retained OHLC bar (same contract as
	 * `toSeriesPoints`), `null`-valued except where a visible marker was placed. Markers are
	 * sourced separately from the loaded series (e.g. a DuckDB `markers` table), so a marker's
	 * timestamp has no guarantee of landing exactly on a retained bar — `findClosestBar` resolves
	 * the nearest one that actually has a non-null value for the marker's dimension, skipping
	 * both a null-valued bar at that row and a bar with no entry at all (an incomplete-OHLC row,
	 * absent from `barIndices`).
	 *
	 * A single slot array can only carry ONE value per bar, so when several markers (even from
	 * different dimensions) resolve to the SAME bar, each one after the first goes into its own
	 * additional slot instead of overwriting the one before it — every visible marker always gets
	 * a point somewhere. The common case (no collisions) returns exactly one slot.
	 */
	private toMarkerSeriesPoints(barIndices: readonly number[]): SeriesPoint[][] {
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
			slotCount = Math.max(slotCount, group.length);
		}

		const slots: SeriesPoint[][] = Array.from({ length: slotCount }, () =>
			barIndices.map((i) => ({ time: timestamps[i] as number, value: null }))
		);

		for (const group of byPosition.values()) {
			group.forEach((entry, slot) => {
				const i = barIndices[entry.position];
				slots[slot][entry.position] = {
					time: timestamps[i] as number,
					value: this.dataset[entry.dimName]?.[i] as number,
					color: entry.marker.color
				};
			});
		}

		return slots;
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
