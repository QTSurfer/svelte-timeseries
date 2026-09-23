import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VelaTimeSeriesChartBuilder } from '../../src/lib/VelaTimeSeriesChartBuilder';

function createMockChart() {
	let visibleRange: { from: number; to: number } | null = { from: 1000, to: 3000 };

	return {
		setMarket: vi.fn(),
		getVisibleRange: vi.fn(() => visibleRange),
		setVisibleRange: vi.fn((range: { from: number; to: number }) => {
			visibleRange = range;
		}),
		marks: {
			set: vi.fn(),
			clear: vi.fn()
		}
	};
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
		chart = createMockChart();
		builder = new VelaTimeSeriesChartBuilder(chart as never);
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

		it('is a no-op before a candlestick series has been set', () => {
			builder.updateDimensions({ _ts: [1000], open: [1] }, ['open']);
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

	describe('markers', () => {
		it('adds a marker and syncs it to the chart as a timeline mark', () => {
			builder.setCandlestickSeries(data, dims);
			chart.marks.set.mockClear();

			builder.addMarkerPoint(
				1,
				{ dimName: 'close', timestamp: 2000, name: 'Buy' },
				{
					color: '#ff0000',
					icon: 'circle'
				}
			);

			expect(chart.marks.set).toHaveBeenCalledWith([
				expect.objectContaining({
					id: 'close-1',
					time: 2000,
					title: 'Buy',
					glyph: { shape: 'circle', color: '#ff0000' }
				})
			]);
		});

		it('toggles a marker off and back on', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });
			chart.marks.set.mockClear();

			builder.toggleMarkers(1, 'close', 'circle');
			expect(chart.marks.set).toHaveBeenLastCalledWith([]);

			builder.toggleMarkers(1, 'close', 'circle');
			expect(chart.marks.set).toHaveBeenLastCalledWith([
				expect.objectContaining({ id: 'close-1' })
			]);
		});

		it('clears all markers', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000 });

			builder.clearMarkers();

			expect(chart.marks.clear).toHaveBeenCalledTimes(1);
		});
	});

	describe('unsupported generic series methods', () => {
		it('throws on setDataset', () => {
			expect(() => builder.setDataset({ _ts: [1000], price: [1] })).toThrow(
				/does not support setDataset/
			);
		});

		it('throws on addDimension', () => {
			builder.setCandlestickSeries(data, dims);
			expect(() => builder.addDimension({ ema: [1, 2, 3] }, 'ema')).toThrow(
				/does not support addDimension/
			);
		});
	});
});
