import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VelaTimeSeriesChartBuilder } from '../../src/lib/VelaTimeSeriesChartBuilder';

// Mirrors the relevant slice of Vela's real native-indicator registration + lifecycle:
// registerNativeIndicator stores one descriptor (module-global, like the real API);
// addNativeIndicator synchronously calls descriptor.create() (as the real orchestrator does)
// but only calls start(ctx) once the test explicitly resolves it via resolveOverlayReady,
// mirroring the real API's async readiness wait before start() fires. Each addNativeIndicator
// call (the constructor's first one, and one per remount after a remove()) mints a fresh
// instance/handle, exactly like Vela's real addNativeIndicator does.
type MockNativeInstance = {
	start: (ctx: unknown) => void;
	onViewport: (range: { from: number; to: number }) => void;
};

let registeredDescriptor: {
	reactsToViewport?: boolean;
	create: () => MockNativeInstance;
} | null = null;

vi.mock('@luxalgo/vela', () => ({
	registerNativeIndicator: vi.fn((descriptor) => {
		registeredDescriptor = descriptor;
	})
}));

function createMockChart() {
	let visibleRange: { from: number; to: number } | null = { from: 1000, to: 3000 };
	// Only the LATEST addNativeIndicator's instance/handle is live — a remove() on an older
	// handle doesn't matter here since the builder never touches a handle it removed.
	let pendingInstance: MockNativeInstance | null = null;
	let currentHandle: { remove: ReturnType<typeof vi.fn> } | null = null;

	return {
		setMarket: vi.fn(() => Promise.resolve()),
		getVisibleRange: vi.fn(() => visibleRange),
		setVisibleRange: vi.fn((range: { from: number; to: number }) => {
			visibleRange = range;
		}),
		addNativeIndicator: vi.fn(() => {
			if (!registeredDescriptor) throw new Error('No native indicator registered');
			pendingInstance = registeredDescriptor.create();
			currentHandle = { remove: vi.fn() };
			return currentHandle;
		}),
		/** Test-only helper: fires the LATEST instance's start(ctx), like Vela's async readiness wait resolving. */
		resolveOverlayReady(ctx: unknown) {
			pendingInstance?.start(ctx);
		},
		/**
		 * Test-only helper: the orchestrator's debounced viewport poke, which Vela only sends to a
		 * native whose descriptor sets `reactsToViewport`.
		 */
		settleViewport() {
			if (!registeredDescriptor?.reactsToViewport || !visibleRange) return;
			pendingInstance?.onViewport(visibleRange);
		},
		/** Test-only helper: the handle from the most recent addNativeIndicator call. */
		currentOverlayHandle() {
			return currentHandle;
		}
	};
}

function createMockOverlayCtx() {
	return { emit: vi.fn() };
}

const dims = { open: 'open', high: 'high', low: 'low', close: 'close' };
const data = {
	_ts: [1000, 2000, 3000],
	open: [100, 101, 102],
	high: [105, 106, 107],
	low: [99, 100, 101],
	close: [104, 105, 106]
};

describe('VelaTimeSeriesChartBuilder', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: VelaTimeSeriesChartBuilder;

	beforeEach(() => {
		// registeredDescriptor is deliberately NOT reset here: the real
		// ensureOverlayRegistered() registers its type once per process (module-level guard),
		// so only the first VelaTimeSeriesChartBuilder instance across this whole test file
		// actually calls registerNativeIndicator — every later instance's addNativeIndicator
		// reuses that same descriptor, exactly like in production with multiple charts.
		chart = createMockChart();
		builder = new VelaTimeSeriesChartBuilder(chart as never);
	});

	it('registers a single-instance, legend-less native indicator to back the overlay channel', () => {
		expect(chart.addNativeIndicator).toHaveBeenCalledTimes(1);
		expect(registeredDescriptor).toMatchObject({
			type: expect.any(String),
			legend: false,
			multiInstance: false
		});
	});

	describe('setCandlestickSeries', () => {
		it('feeds OHLCV data to the chart via setMarket', () => {
			const result = builder.setCandlestickSeries(data, dims);

			expect(result).toBe(builder);
			expect(chart.setMarket).toHaveBeenCalledTimes(1);
			expect(chart.setMarket).toHaveBeenCalledWith({
				data: [
					{ time: 1000, open: 100, high: 105, low: 99, close: 104 },
					{ time: 2000, open: 101, high: 106, low: 100, close: 105 },
					{ time: 3000, open: 102, high: 107, low: 101, close: 106 }
				]
			});
		});

		it('marks Candlestick as selected and exposes the loaded OHLC dimensions', () => {
			builder.setCandlestickSeries(data, dims);

			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
			expect(builder.getLoadedDimensions()).toEqual(['open', 'high', 'low', 'close']);
			expect(builder.getActiveDimensions()).toEqual(['open', 'high', 'low', 'close']);
		});

		it('skips incomplete candles instead of converting nulls to zero', () => {
			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000],
					open: [null, 101],
					high: [105, 106],
					low: [99, 100],
					close: [104, 105]
				},
				dims
			);

			expect(chart.setMarket).toHaveBeenLastCalledWith({
				data: [{ time: 2000, open: 101, high: 106, low: 100, close: 105 }]
			});
		});

		it('replaces the market data on every call instead of accumulating series', () => {
			builder.setCandlestickSeries(data, dims);
			builder.setCandlestickSeries(data, dims);

			expect(chart.setMarket).toHaveBeenCalledTimes(2);
		});

		it('reports the dataset range', () => {
			builder.setCandlestickSeries(data, dims);
			expect(builder.getRangeValues()).toEqual([1000, 3000]);
			expect(builder.getTotalRows()).toBe(3);
		});
	});

	describe('addDimension (overlay line series)', () => {
		it('is a no-op on the emit channel until the overlay context is ready', () => {
			builder.setCandlestickSeries(data, dims);
			expect(() => builder.addDimension({ ema: [100, 101, 102] }, 'ema')).not.toThrow();
			expect(builder.getLoadedDimensions()).toEqual(['open', 'high', 'low', 'close', 'ema']);
		});

		it('emits the extra dimension as a visible line series once the overlay is ready', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						title: 'ema',
						kind: 'line',
						visible: true,
						points: [
							{ time: 1000, value: 100 },
							{ time: 2000, value: 101 },
							{ time: 3000, value: 102 }
						]
					})
				],
				polylines: []
			});
		});

		it('re-emits after addDimension once the overlay context is already available', () => {
			builder.setCandlestickSeries(data, dims);
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			builder.addDimension({ ema: [100, 101, 102] }, 'ema');

			// A new dimension is a structural change: it goes through remove + re-add, so the
			// FRESH indicator's own context (not the original `ctx`, which was removed) is what
			// actually emits — resolve it to observe the result.
			const freshCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(freshCtx);

			expect(freshCtx.emit).toHaveBeenCalledTimes(1);
			expect(freshCtx.emit).toHaveBeenCalledWith({
				series: [expect.objectContaining({ title: 'ema' })],
				polylines: []
			});
		});

		it('honors toggleLegend visibility for the emitted line series', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.toggleLegend('ema');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [expect.objectContaining({ title: 'ema', visible: false })],
				polylines: []
			});
		});

		it('emits every added dimension, not just the first one (regression)', () => {
			// Regression: Vela's native-indicator patch path only updates a series whose id
			// was already present at the indicator's last mount — a plain emit() naming a new
			// series id was silently dropped, so adding a second/third dimension after the
			// first never showed up.
			builder.setCandlestickSeries(data, dims);
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			chart.resolveOverlayReady(createMockOverlayCtx());
			builder.addDimension({ sma: [99, 100, 101] }, 'sma');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({ title: 'ema' }),
					expect.objectContaining({ title: 'sma' })
				],
				polylines: []
			});
		});

		it('remounts (remove + re-add) only when the set of series ids changes', () => {
			builder.setCandlestickSeries(data, dims);
			chart.resolveOverlayReady(createMockOverlayCtx());
			chart.addNativeIndicator.mockClear();

			// First dimension: the series id set grows from [] to ['overlay-line-ema'] — remount.
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			expect(chart.addNativeIndicator).toHaveBeenCalledTimes(1);
			chart.resolveOverlayReady(createMockOverlayCtx());
			chart.addNativeIndicator.mockClear();

			// Re-adding the SAME dimension (a value update, e.g. from updateDimensions) keeps
			// the same series id set — no remount needed, straight to emit on the live context.
			builder.addDimension({ ema: [200, 201, 202] }, 'ema');
			expect(chart.addNativeIndicator).not.toHaveBeenCalled();
		});

		it('remounts so a hidden line actually disappears (regression)', () => {
			// Regression: toggling a dimension off/on had no visual effect because Vela's patch
			// path only updates a series's `points`, never its `visible` flag — the remove +
			// re-add forces the hidden state to actually take effect (via a fresh mount).
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			chart.resolveOverlayReady(createMockOverlayCtx());
			chart.addNativeIndicator.mockClear();

			// toggleLegend does not change the series id set (still ['overlay-line-ema']), only
			// its visible flag — still expected to trigger a remount.
			builder.toggleLegend('ema');

			expect(chart.addNativeIndicator).toHaveBeenCalledTimes(1);
		});

		it('removes the previous overlay indicator before mounting the replacement', () => {
			builder.setCandlestickSeries(data, dims);
			chart.resolveOverlayReady(createMockOverlayCtx());
			const firstHandle = chart.currentOverlayHandle();

			builder.addDimension({ ema: [100, 101, 102] }, 'ema');

			expect(firstHandle?.remove).toHaveBeenCalledTimes(1);
		});

		it('surfaces a failed remount and retries it on the next mutation instead of staying blocked', () => {
			builder.setCandlestickSeries(data, dims);
			chart.resolveOverlayReady(createMockOverlayCtx());
			chart.addNativeIndicator.mockImplementationOnce(() => {
				throw new Error('addNativeIndicator failed');
			});

			expect(() => builder.addDimension({ ema: [100, 101, 102] }, 'ema')).toThrow(
				'addNativeIndicator failed'
			);

			// The failure must not leave the overlay blocked: the next mutation mounts again.
			chart.addNativeIndicator.mockClear();
			builder.addDimension({ ema: [200, 201, 202] }, 'ema');
			expect(chart.addNativeIndicator).toHaveBeenCalledTimes(1);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			expect(ctx.emit).toHaveBeenCalledWith(
				expect.objectContaining({
					series: [expect.objectContaining({ title: 'ema' })]
				})
			);
		});

		it('ends up with both dimensions regardless of which async caller resolves last (regression)', () => {
			// Regression: TimeSeriesFacade.addDimension is async (it awaits a DuckDB query per
			// column) — toggling two schema columns in quick succession fires two independent
			// addDimension calls on this builder whose CALLERS can resolve in either order. Each
			// call here stands in for one such caller's `await` finally landing; the overlay must
			// end up showing both lines no matter which one lands first.
			builder.setCandlestickSeries(data, dims);
			chart.resolveOverlayReady(createMockOverlayCtx());

			// Simulates the second click's query (bid) winning the race and landing first.
			builder.addDimension({ bid: [1, 2, 3] }, 'bid');
			chart.resolveOverlayReady(createMockOverlayCtx());
			// Then the first click's query (vol) lands.
			builder.addDimension({ vol: [4, 5, 6] }, 'vol');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			const titles = ctx.emit.mock.calls.at(-1)?.[0].series.map((s: { title: string }) => s.title);
			expect(titles).toEqual(expect.arrayContaining(['bid', 'vol']));
			expect(titles).toHaveLength(2);
		});
	});

	describe('updateDimensions', () => {
		it('re-feeds the chart with merged OHLC columns', () => {
			builder.setCandlestickSeries(data, dims);

			builder.updateDimensions(
				{
					_ts: [2000, 3000],
					open: [201, 202],
					high: [206, 207],
					low: [200, 201],
					close: [205, 206]
				},
				['open', 'high', 'low', 'close']
			);

			expect(chart.setMarket).toHaveBeenLastCalledWith({
				data: [
					{ time: 2000, open: 201, high: 206, low: 200, close: 205 },
					{ time: 3000, open: 202, high: 207, low: 201, close: 206 }
				]
			});
		});

		it('does not touch the market when only a non-OHLC dimension updates', () => {
			builder.setCandlestickSeries(data, dims);
			chart.setMarket.mockClear();

			builder.updateDimensions({ ema: [1, 2, 3] }, ['ema']);

			expect(chart.setMarket).not.toHaveBeenCalled();
		});

		it('reflects updated values after updateDimensions instead of serving stale cached line points (regression)', () => {
			// Regression: a line's points are now cached across emits to avoid rebuilding every
			// line on every marker-only mutation (see emitOverlay). The cache must still be
			// invalidated when that dimension's own data changes via updateDimensions.
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			builder.updateDimensions({ ema: [200, 201, 202] }, ['ema']);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						title: 'ema',
						points: [
							{ time: 1000, value: 200 },
							{ time: 2000, value: 201 },
							{ time: 3000, value: 202 }
						]
					})
				],
				polylines: []
			});
		});
	});

	describe('zoom and scroll', () => {
		it('maps zoom percentages to a visible time range', () => {
			builder.setCandlestickSeries(data, dims);

			builder.goToZoom(25, 75);

			expect(chart.setVisibleRange).toHaveBeenCalledWith({ from: 1500, to: 2500 });
		});

		it('centers the visible range around a timestamp, clamped to a minimum width', () => {
			builder.setCandlestickSeries(data, dims);
			chart.setVisibleRange.mockClear();

			// The initial mocked visible range is only 2000ms wide (from: 1000, to: 3000),
			// narrower than the 60000ms minimum window scrollToTime enforces.
			builder.scrollToTime(2000);

			expect(chart.setVisibleRange).toHaveBeenCalledWith({ from: -28000, to: 32000 });
		});
	});

	describe('markers (overlay circles series)', () => {
		// Vela's native renderer has no painter for `kind: 'markers'` (MarkerSeries) — see
		// emitOverlay's comment. A marker is instead one point in a `kind: 'circles'` line-like
		// series, anchored at its dimension's actual value at that timestamp (close is 105 at
		// timestamp 2000 in `data`), the same way markPoint/createSeriesMarkers anchor markers
		// for the ECharts/Lightweight builders.
		//
		// `emitPointMarkers` (Vela's compiled renderer) reads a circles series' `points` by BAR
		// INDEX — `points[i - offset]` for chart bar `i`, no time lookup — so the array must be
		// index-aligned with the chart's own bars, one entry per retained bar, not a sparse list
		// of just the markers. A point's own `value`/`color` carry the content; its `time` is
		// along for the ride (unused by the renderer, which positions purely by loop index) but
		// set to the bar's own time for consistency with `toSeriesPoints`.
		it('emits a visible marker as a circles-series point anchored at its bar position', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000, name: 'Buy' },
				{ color: '#ff0000', icon: 'circle' }
			);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						kind: 'circles',
						points: [
							{ time: 1000, value: null },
							{ time: 2000, value: 105, color: '#ff0000' },
							{ time: 3000, value: null }
						]
					})
				],
				polylines: []
			});
		});

		it('anchors to the closest bar when the timestamp has no exact match (regression)', () => {
			// Regression: markers are sourced separately from the candlestick series (e.g. a
			// DuckDB `markers` table), so a marker's timestamp isn't guaranteed to land exactly
			// on a loaded bar. An exact-match lookup silently dropped the marker — this finds
			// the closest bar instead, the same fix applied to the ECharts builder.
			builder.setCandlestickSeries(data, dims);
			// timestamp 4000 doesn't exist in `data._ts` (max is 3000) — closest bar is index 2
			// (time 3000, close: 106); the point's `time` is that BAR's time, not the marker's own
			// requested timestamp (unused by the renderer — see the describe-level comment).
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 4000 });

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						kind: 'circles',
						points: [
							{ time: 1000, value: null },
							{ time: 2000, value: null },
							{ time: 3000, value: 106, color: '#000000' }
						]
					})
				],
				polylines: []
			});
		});

		it('skips a null value at the closest bar and keeps searching (regression)', () => {
			// Regression: a "partial data" dataset can have a null in the dimension's own value
			// column independently of which timestamps exist — the closest-timestamp bar can
			// land exactly on such a gap. Must fall through to the next-closest bar with a
			// non-null value instead of anchoring to null. The gap (timestamp 2000) also has a
			// null `close`, so it fails the candlestick's own completeness filter and is excluded
			// from the retained bars entirely (barIndices = [0, 2], not [0, 1, 2]) — the marker
			// lands at ARRAY POSITION 1 (the second retained bar, time 3000), not index 2.
			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000, 3000],
					open: [100, 101, 102],
					high: [105, 106, 107],
					low: [99, 100, 101],
					close: [104, null, 106]
				},
				dims
			);
			// 2000 is the closest timestamp to 2100, but its candle is incomplete (excluded from
			// the retained bars) — falls through to the next retained bar (3000, close: 106).
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2100 });

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						kind: 'circles',
						points: [
							{ time: 1000, value: null },
							{ time: 3000, value: 106, color: '#000000' }
						]
					})
				],
				polylines: []
			});
		});

		it('aligns an extra dimension line with the OHLC-filtered bars, not the raw dataset (regression)', () => {
			// Regression: `toOHLCV` drops a bar whenever any OHLC component is null, shrinking
			// and re-indexing the chart's own bar array. An overlay line that instead kept one
			// point per raw dataset row (including the dropped bar) was index-misaligned with
			// the chart's bars from that point on — every later value plotted one bar early.
			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000, 3000, 4000],
					open: [100, 101, 102, 103],
					high: [105, 106, 107, 108],
					low: [99, 100, 101, 102],
					close: [104, null, 106, 107] // bar at 2000 is incomplete — excluded from the chart
				},
				dims
			);
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.addDimension({ sma: [10, 20, 30, 40] }, 'sma');
			// A new dimension is a structural change (remove + re-add) — resolve the fresh
			// indicator's own context to observe the result (same pattern as the addDimension
			// tests above).
			const freshCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(freshCtx);

			expect(freshCtx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						id: 'overlay-line-sma',
						// 3 points (bars 1000, 3000, 4000), not 4 — the 2000 row has no bar to
						// align to, and its sma value (20) has nowhere valid to render.
						points: [
							{ time: 1000, value: 10 },
							{ time: 3000, value: 30 },
							{ time: 4000, value: 40 }
						]
					})
				],
				polylines: []
			});
		});

		it('renders two markers landing on the same bar as separate slots instead of one overwriting the other (regression)', () => {
			// Regression: a `circles` series carries one value per bar, so two markers resolving
			// to the same bar (here: 'close' and 'high', both anchored at timestamp 2000) used to
			// overwrite each other in a single shared points array — the second one silently
			// disappeared. Each slot beyond the first is now its own `circles` series.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 }, { color: '#ff0000' });
			chart.resolveOverlayReady(createMockOverlayCtx());

			// overlay-markers-1 is a new series id, so adding the second, colliding marker grows
			// the id set and remounts like any other structural change — resolve the fresh
			// indicator's context to observe the result.
			builder.addMarkerPoint(2, { dimName: 'high', timestamp: 2000 }, { color: '#00ff00' });
			const freshCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(freshCtx);

			expect(freshCtx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						id: 'overlay-markers',
						kind: 'circles',
						points: [
							{ time: 1000, value: null },
							{ time: 2000, value: 105, color: '#ff0000' },
							{ time: 3000, value: null }
						]
					}),
					expect.objectContaining({
						id: 'overlay-markers-1',
						kind: 'circles',
						points: [
							{ time: 1000, value: null },
							{ time: 2000, value: 106, color: '#00ff00' },
							{ time: 3000, value: null }
						]
					})
				],
				polylines: []
			});
		});

		it('nudges a marker sharing both dimension and bar with an earlier one so it stays visible (regression)', () => {
			// Regression: two markers in different slots but sharing the SAME dimension AND bar
			// still carried the identical (bar, value) — Vela paints circles in series order, so
			// the later one rendered exactly on top of (hiding) the first despite being a separate
			// series. The first marker at a bar+dimension stays exactly on its true value; every
			// later one is nudged so it's visually distinguishable.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 }, { color: '#ff0000' });
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.addMarkerPoint(2, { dimName: 'close', timestamp: 2000 }, { color: '#00ff00' });
			const freshCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(freshCtx);

			const emitted = freshCtx.emit.mock.calls.at(-1)?.[0].series;
			const firstPoint = emitted.find((s: { id: string }) => s.id === 'overlay-markers').points[1];
			const secondPoint = emitted.find((s: { id: string }) => s.id === 'overlay-markers-1')
				.points[1];

			expect(firstPoint.value).toBe(105); // close at bar 1, unmodified
			expect(secondPoint.value).not.toBe(105); // nudged away from the first, not identical
		});

		it('still separates same-dimension duplicates on a flat (high === low) bar (regression)', () => {
			// Regression: the nudge used to be a fraction of the bar's own high-low range, which is
			// 0 for a flat candle — both circles landed on the exact same pixels. It's now sized
			// from the visible price range: high 107 / low 99 across the 3 visible bars → polygon
			// height 0.36 → the second duplicate sits 0.36 * 1.5 = 0.54 above the first.
			const flat = {
				...data,
				open: [100, 105, 102],
				high: [105, 105, 107],
				low: [99, 105, 101],
				close: [104, 105, 106]
			};
			builder.setCandlestickSeries(flat, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 }, { color: '#ff0000' });
			builder.addMarkerPoint(2, { dimName: 'close', timestamp: 2000 }, { color: '#00ff00' });
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			const emitted = ctx.emit.mock.calls.at(-1)?.[0].series;
			const first = emitted.find((s: { id: string }) => s.id === 'overlay-markers').points[1];
			const second = emitted.find((s: { id: string }) => s.id === 'overlay-markers-1').points[1];

			expect(first.value).toBe(105);
			expect(second.value).toBeCloseTo(105.54);
		});

		it('clears only the marker cell that changed, leaving an unrelated marker in the same slot untouched (regression)', () => {
			// Regression: marker slot buffers are now reused/mutated in place across emits instead
			// of rebuilt from scratch on every mutation — toggling one marker off must clear only
			// that marker's own cell, not leave stale state elsewhere or wipe a different marker
			// sharing the same slot.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 1000 });
			builder.addMarkerPoint(2, { dimName: 'close', timestamp: 3000 });
			// Both markers sit in slot 0 (different bars, no collision) — toggling one off doesn't
			// change the series id set, so this never remounts: the same ctx stays live throughout.
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			builder.toggleMarkers(1, 'close', 'circle');

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({
						id: 'overlay-markers',
						points: [
							{ time: 1000, value: null },
							{ time: 2000, value: null },
							{ time: 3000, value: 106, color: '#000000' }
						]
					})
				],
				polylines: []
			});
		});

		it('toggles a marker off and back on', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.toggleMarkers(1, 'close', 'circle');
			const offCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(offCtx);
			expect(offCtx.emit).toHaveBeenLastCalledWith({ series: [], polylines: [] });

			builder.toggleMarkers(1, 'close', 'circle');
			const onCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(onCtx);
			expect(onCtx.emit).toHaveBeenLastCalledWith({
				series: [expect.objectContaining({ kind: 'circles' })],
				polylines: []
			});
		});

		it('clears all markers', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.clearMarkers();
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({ series: [], polylines: [] });
		});
	});

	describe('arrow and square markers (hand-built polyline shapes)', () => {
		// Vela's native point-marker kinds are only 'circles'/'cross' — see customMarkerShape's
		// doc comment. 'arrowUp'/'arrowDown'/'square' are instead emitted as closed, filled
		// DrawingPolyline shapes, so all four cross-engine-consistent icons
		// (circle/square/arrowUp/arrowDown) render distinctly here too.
		it('emits an arrowUp marker as an upward-pointing filled triangle, not a circles point', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000, name: 'Buy' },
				{ color: '#16a34a', icon: 'arrowUp' }
			);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			// polygonHeight is a fraction of the price range of the bars inside getVisibleRange()
			// (mocked to {from:1000,to:3000} — all 3 bars) — max high 107, min low 99, so height =
			// (107-99)*0.045 = 0.36. An up arrow is centered AT the marker's own value (bar 1's
			// close, 105 — same anchor a circle/square marker uses): apex = 105 + 0.18 = 105.18,
			// base = apex - height = 104.82. polygonHalfWidth is a fraction of the visible TIME
			// range (not the bar interval directly), so it stays a constant fraction of the
			// chart's own width regardless of zoom: (3000-1000)*0.019 = 38.
			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [],
				polylines: [
					{
						id: 'overlay-triangle-close-1',
						paneId: 'price',
						overlay: true,
						points: [
							{ xloc: 'bar_time', x: 2000, price: 105.18 },
							{ xloc: 'bar_time', x: 1962, price: 104.82 },
							{ xloc: 'bar_time', x: 2038, price: 104.82 }
						],
						curved: false,
						closed: true,
						fillColor: '#16a34a',
						lineColor: '#16a34a',
						lineWidth: 1,
						lineStyle: 'solid',
						arrowLeft: false,
						arrowRight: false
					}
				]
			});
		});

		it('emits an arrowDown marker pointing the opposite way, anchored above the bar high', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000, name: 'Sell' },
				{ color: '#dc2626', icon: 'arrowDown' }
			);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			// A down arrow is centered at the same value (105) but points the other way: apex =
			// 105 - 0.18 = 104.82, base = apex + height(0.36) = 105.18 (see the arrowUp test above
			// for how height is computed).
			const polyline = ctx.emit.mock.calls.at(-1)?.[0].polylines[0];
			expect(polyline.points).toEqual([
				{ xloc: 'bar_time', x: 2000, price: 104.82 },
				{ xloc: 'bar_time', x: 1962, price: 105.18 },
				{ xloc: 'bar_time', x: 2038, price: 105.18 }
			]);
		});

		it('emits a square marker as a filled quad anchored at its actual value, not bar-relative', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000, name: 'Neutral' },
				{ color: '#000000', icon: 'square' }
			);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			// Bar 1 (time 2000): close 105 — a square anchors AT the dimension's own value (like a
			// circle), unlike the bar-relative triangle. polygonHeight = 0.36 (see the arrowUp
			// test above), halfHeight = 0.18; halfWidth matches the triangle's own
			// polygonHalfWidth exactly (38), unlike before — see buildSquarePolyline's comment.
			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [],
				polylines: [
					{
						id: 'overlay-square-close-1',
						paneId: 'price',
						overlay: true,
						points: [
							{ xloc: 'bar_time', x: 1962, price: 105.18 },
							{ xloc: 'bar_time', x: 2038, price: 105.18 },
							{ xloc: 'bar_time', x: 2038, price: 104.82 },
							{ xloc: 'bar_time', x: 1962, price: 104.82 }
						],
						curved: false,
						closed: true,
						fillColor: '#000000',
						lineColor: '#000000',
						lineWidth: 1,
						lineStyle: 'solid',
						arrowLeft: false,
						arrowRight: false
					}
				]
			});
		});

		it('does not spend a circles slot on an arrow marker colliding with a circle one on the same bar', () => {
			// Regression risk: slotCount used to be computed from every marker landing on a bar,
			// regardless of shape — an arrow marker sharing a bar with a circle one would have
			// forced a pointless extra (all-null) circles series.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000 },
				{ color: '#000000', icon: 'circle' }
			);
			builder.addMarkerPoint(
				2,
				{ dimName: 'high', timestamp: 2000 },
				{ color: '#16a34a', icon: 'arrowUp' }
			);

			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			const emitted = ctx.emit.mock.calls.at(-1)?.[0];
			expect(emitted.series).toHaveLength(1);
			expect(emitted.series[0].id).toBe('overlay-markers');
			expect(emitted.polylines).toHaveLength(1);
		});

		it('drops a toggled-off arrow marker from polylines without needing a remount', () => {
			// Unlike circles, applyPatch replaces model.polylines wholesale on every patch, so an
			// arrow marker's visibility never needs the remove+re-add dance — same ctx stays live.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000 },
				{ color: '#16a34a', icon: 'arrowUp' }
			);
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			expect(ctx.emit.mock.calls.at(-1)?.[0].polylines).toHaveLength(1);

			builder.toggleMarkers(1, 'close', 'arrowUp');

			expect(ctx.emit.mock.calls.at(-1)?.[0].polylines).toEqual([]);
		});

		it('re-sizes polygon markers against the new visible range once a zoom/pan settles (regression)', () => {
			// Regression: polygons were sized from the visible range only at emit time and
			// onViewport was a no-op, so zooming kept their stale data-space size and they grew or
			// shrank on screen.
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000 },
				{ color: '#16a34a', icon: 'arrowUp' }
			);
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			// Zoom into bars 0-1 only: span 1000ms → halfWidth 19; visible high 106, low 99 →
			// height 0.315, so the apex sits at 105 + 0.1575.
			chart.setVisibleRange({ from: 1000, to: 2000 });
			chart.settleViewport();

			const [apex, baseLeft, baseRight] = ctx.emit.mock.calls.at(-1)?.[0].polylines[0].points;
			expect(apex.price).toBeCloseTo(105.1575);
			expect(baseLeft.price).toBeCloseTo(104.8425);
			expect(baseLeft.x).toBe(1981);
			expect(baseRight.x).toBe(2019);
		});

		it('does not re-emit on viewport changes when no polygon markers are shown', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 }, { color: '#000000' });
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			const emitsBefore = ctx.emit.mock.calls.length;

			chart.setVisibleRange({ from: 1000, to: 2000 });
			chart.settleViewport();

			expect(ctx.emit.mock.calls.length).toBe(emitsBefore);
		});
	});

	describe('unsupported generic series methods', () => {
		it('throws on setDataset', () => {
			expect(() => builder.setDataset({ _ts: [1000], price: [1] })).toThrow(
				/does not support setDataset/
			);
		});
	});
});
