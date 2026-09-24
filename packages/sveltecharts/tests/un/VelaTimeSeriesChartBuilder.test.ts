import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VelaTimeSeriesChartBuilder } from '../../src/lib/VelaTimeSeriesChartBuilder';

// Mirrors the relevant slice of Vela's real native-indicator registration + lifecycle:
// registerNativeIndicator stores one descriptor (module-global, like the real API);
// addNativeIndicator synchronously calls descriptor.create() (as the real orchestrator does)
// but only calls start(ctx) once the test explicitly resolves it via resolveOverlayReady,
// mirroring the real API's async readiness wait before start() fires. Each addNativeIndicator
// call (the constructor's first one, and one per remount after a remove()) mints a fresh
// instance/handle, exactly like Vela's real addNativeIndicator does.
let registeredDescriptor: {
	create: () => { start: (ctx: unknown) => void };
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
	let pendingInstance: { start: (ctx: unknown) => void } | null = null;
	let currentHandle: { remove: ReturnType<typeof vi.fn> } | null = null;

	return {
		setMarket: vi.fn(),
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
				]
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
				series: [expect.objectContaining({ title: 'ema' })]
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
				series: [expect.objectContaining({ title: 'ema', visible: false })]
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
				]
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

	describe('markers (overlay marker series)', () => {
		it('emits a visible marker as a marker series once the overlay is ready', () => {
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
						kind: 'markers',
						markers: [
							expect.objectContaining({
								time: 2000,
								shape: 'circle',
								color: '#ff0000',
								text: 'Buy'
							})
						]
					})
				]
			});
		});

		it('toggles a marker off and back on', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.toggleMarkers(1, 'close', 'circle');
			const offCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(offCtx);
			expect(offCtx.emit).toHaveBeenLastCalledWith({ series: [] });

			builder.toggleMarkers(1, 'close', 'circle');
			const onCtx = createMockOverlayCtx();
			chart.resolveOverlayReady(onCtx);
			expect(onCtx.emit).toHaveBeenLastCalledWith({
				series: [expect.objectContaining({ kind: 'markers' })]
			});
		});

		it('clears all markers', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			chart.resolveOverlayReady(createMockOverlayCtx());

			builder.clearMarkers();
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			expect(ctx.emit).toHaveBeenLastCalledWith({ series: [] });
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
