import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VelaTimeSeriesChartBuilder } from '../../src/lib/VelaTimeSeriesChartBuilder';

// Mirrors the relevant slice of Vela's real native-indicator registration + lifecycle:
// registerNativeIndicator stores one descriptor (module-global, like the real API);
// addNativeIndicator synchronously calls descriptor.create() (as the real orchestrator does)
// but only calls start(ctx) once the test explicitly resolves it via resolveOverlayReady,
// mirroring the real API's async readiness wait before start() fires.
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
	let pendingInstance: { start: (ctx: unknown) => void } | null = null;
	const overlayHandle = { setVisible: vi.fn() };

	return {
		setMarket: vi.fn(),
		getVisibleRange: vi.fn(() => visibleRange),
		setVisibleRange: vi.fn((range: { from: number; to: number }) => {
			visibleRange = range;
		}),
		addNativeIndicator: vi.fn(() => {
			if (!registeredDescriptor) throw new Error('No native indicator registered');
			pendingInstance = registeredDescriptor.create();
			return overlayHandle;
		}),
		overlayHandle,
		/** Test-only helper: fires the instance's start(ctx), like Vela's async readiness wait resolving. */
		resolveOverlayReady(ctx: unknown) {
			pendingInstance?.start(ctx);
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
			ctx.emit.mockClear();

			builder.addDimension({ ema: [100, 101, 102] }, 'ema');

			expect(ctx.emit).toHaveBeenCalledTimes(1);
			expect(ctx.emit).toHaveBeenCalledWith({
				series: [expect.objectContaining({ title: 'ema' })]
			});
		});

		it('honors toggleLegend visibility for the emitted line series', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			ctx.emit.mockClear();

			builder.toggleLegend('ema');

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
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);

			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			builder.addDimension({ sma: [99, 100, 101] }, 'sma');

			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [
					expect.objectContaining({ title: 'ema' }),
					expect.objectContaining({ title: 'sma' })
				]
			});
		});

		it('forces a remount (setVisible false/true) only when the set of series ids changes', () => {
			builder.setCandlestickSeries(data, dims);
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			chart.overlayHandle.setVisible.mockClear();

			// First dimension: the series id set grows from [] to ['overlay-line-ema'] — remount.
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			expect(chart.overlayHandle.setVisible).toHaveBeenNthCalledWith(1, false);
			expect(chart.overlayHandle.setVisible).toHaveBeenNthCalledWith(2, true);
			chart.overlayHandle.setVisible.mockClear();

			// Re-adding the SAME dimension (a value update, e.g. from updateDimensions) keeps
			// the same series id set — no remount needed.
			builder.addDimension({ ema: [200, 201, 202] }, 'ema');
			expect(chart.overlayHandle.setVisible).not.toHaveBeenCalled();
		});

		it('forces a remount when toggleLegend would otherwise leave the hidden line stuck visible (regression)', () => {
			// Regression: toggling a dimension off/on had no visual effect because Vela's patch
			// path only updates a series's `points`, never its `visible` flag — the remount
			// forces the hidden state to actually take effect.
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [100, 101, 102] }, 'ema');
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			chart.overlayHandle.setVisible.mockClear();

			// toggleLegend does not change the series id set (still ['overlay-line-ema']), only
			// its visible flag — a remount is still required for the visibility flip to render,
			// since Vela's patch path never re-reads `visible` on an existing series.
			builder.toggleLegend('ema');

			expect(chart.overlayHandle.setVisible).toHaveBeenNthCalledWith(1, false);
			expect(chart.overlayHandle.setVisible).toHaveBeenNthCalledWith(2, true);
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
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			ctx.emit.mockClear();

			builder.toggleMarkers(1, 'close', 'circle');
			expect(ctx.emit).toHaveBeenLastCalledWith({ series: [] });

			builder.toggleMarkers(1, 'close', 'circle');
			expect(ctx.emit).toHaveBeenLastCalledWith({
				series: [expect.objectContaining({ kind: 'markers' })]
			});
		});

		it('clears all markers', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			const ctx = createMockOverlayCtx();
			chart.resolveOverlayReady(ctx);
			ctx.emit.mockClear();

			builder.clearMarkers();

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
