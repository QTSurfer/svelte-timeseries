import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LightweightTimeSeriesChartBuilder,
	formatPreciseValue
} from '../../src/lib/LightweightTimeSeriesChartBuilder';

function createMockSeries() {
	return {
		setData: vi.fn(),
		applyOptions: vi.fn()
	};
}

function createMockChart() {
	const visibleLogicalRange = { from: 0, to: 10 };
	const timeScale = {
		getVisibleLogicalRange: vi.fn(() => visibleLogicalRange),
		setVisibleLogicalRange: vi.fn(),
		setVisibleRange: vi.fn(),
		fitContent: vi.fn()
	};

	return {
		addSeries: vi.fn(() => createMockSeries()),
		removeSeries: vi.fn(),
		applyOptions: vi.fn(),
		timeScale: vi.fn(() => timeScale)
	};
}

vi.mock('lightweight-charts', () => ({
	LineSeries: Symbol('LineSeries'),
	CandlestickSeries: Symbol('CandlestickSeries'),
	createSeriesMarkers: vi.fn(() => ({
		setMarkers: vi.fn(),
		detach: vi.fn()
	}))
}));

describe('LightweightTimeSeriesChartBuilder', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		chart = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
	});

	it('accepts simple object datasets and builds the chart', () => {
		const result = builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		expect(result).toBe(builder);
		expect(chart.addSeries).toHaveBeenCalledTimes(1);
		expect(builder.getRangeValues()).toEqual([1000, 3000]);
		expect(builder.getLegendStatus()).toEqual({ price: true });
	});

	it('configures price precision for very small values', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [0.00000385, 0.00000386, 0.00000387]
		});

		expect(chart.addSeries).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				priceFormat: {
					type: 'price',
					precision: 8,
					minMove: 0.00000001
				}
			})
		);
		expect(formatPreciseValue(0.00000385)).toBe('0.00000385');
	});

	it('adds dimensions incrementally and marks them as visible', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.addDimension(
			{
				ema: [99, 100, 101]
			},
			'ema'
		);

		expect(chart.addSeries).toHaveBeenCalledTimes(2);
		expect(builder.getLegendStatus()).toEqual({ price: true, ema: true });
	});

	it('toggles series visibility', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.toggleLegend('price');

		expect(builder.getLegendStatus()).toEqual({ price: false });
	});

	it('maps zoom percentages to visible time range', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.goToZoom(25, 75);

		const timeScale = chart.timeScale();
		expect(timeScale.setVisibleRange).toHaveBeenCalledWith({
			from: 1,
			to: 2
		});
	});

	describe('setCandlestickSeries', () => {
		const dims = { open: 'open', high: 'high', low: 'low', close: 'close' };
		const data = {
			_ts: [1000, 2000, 3000],
			open: [100, 101, 102],
			high: [105, 106, 107],
			low: [99, 100, 101],
			close: [104, 105, 106]
		};

		it('adds a candlestick series and feeds it OHLC data', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);

			builder.setCandlestickSeries(data, dims);

			expect(chart.addSeries).toHaveBeenCalledTimes(1);
			expect(candleSeries.setData).toHaveBeenCalledTimes(1);

			const passed = candleSeries.setData.mock.calls[0][0];
			expect(passed).toHaveLength(3);
			expect(passed[0]).toEqual({
				time: 1,
				open: 100,
				high: 105,
				low: 99,
				close: 104
			});
		});

		it('marks Candlestick as selected in the legend', () => {
			builder.setCandlestickSeries(data, dims);
			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
		});

		it('removes the previous candlestick before adding a new one on rebuild', () => {
			builder.setCandlestickSeries(data, dims);
			builder.setCandlestickSeries(data, dims);

			// First call: add 1 candle. Second call: removeSeries on the old one, then add a new one.
			expect(chart.removeSeries).toHaveBeenCalledTimes(1);
			expect(chart.addSeries).toHaveBeenCalledTimes(2);
		});

		it('does not crash when addDimension is called after setCandlestickSeries (regression)', () => {
			builder.setCandlestickSeries(data, dims);

			// Before the fix, dataset was undefined here and this threw
			// "Cannot read properties of undefined (reading 'push')".
			expect(() => builder.addDimension({ ema: [103, 104, 105] }, 'ema')).not.toThrow();

			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
			expect(builder.getLegendStatus()).toHaveProperty('ema', true);
		});

		it('deduplicates rows that map to the same chart time', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);

			// Two timestamps that fall in the same second after toChartTime conversion
			// (1500 ms and 1700 ms both → second 1).
			builder.setCandlestickSeries(
				{
					_ts: [1500, 1700, 3000],
					open: [100, 101, 102],
					high: [105, 106, 107],
					low: [99, 100, 101],
					close: [104, 105, 106]
				},
				dims
			);

			const passed = candleSeries.setData.mock.calls[0][0];
			expect(passed).toHaveLength(2);
			expect(passed.map((p: { time: number }) => p.time)).toEqual([1, 3]);
		});
	});
});
