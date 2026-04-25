import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimeSeriesChartBuilder } from '../../src/lib/TimeSeriesChartBuilder';
import type { ECharts } from 'echarts/types/dist/core';

function createMockECharts(): ECharts {
	return {
		setOption: vi.fn(),
		getOption: vi.fn(() => ({ dataZoom: [{ start: 45, end: 55 }] })),
		dispatchAction: vi.fn()
	} as unknown as ECharts;
}

function lastSetOptionCall(echarts: ECharts) {
	const calls = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls;
	return calls[calls.length - 1];
}

describe('TimeSeriesChartBuilder', () => {
	let echarts: ECharts;
	let builder: TimeSeriesChartBuilder;

	beforeEach(() => {
		echarts = createMockECharts();
		builder = new TimeSeriesChartBuilder(echarts);
	});

	describe('constructor', () => {
		it('initializes with default config', () => {
			expect(builder.ECharts).toBe(echarts);
		});

		it('accepts externalManagerLegend config', () => {
			const b = new TimeSeriesChartBuilder(echarts, { externalManagerLegend: true });
			expect(b.ECharts).toBe(echarts);
		});
	});

	describe('setDataset — simple object format', () => {
		it('accepts Record<string, number[]> and builds chart', () => {
			const data = {
				_ts: [1000, 2000, 3000],
				price: [100, 101, 102],
				volume: [500, 600, 700]
			};

			const result = builder.setDataset(data);
			expect(result).toBe(builder);
			expect(echarts.setOption).toHaveBeenCalled();
		});

		it('accepts custom dimension names', () => {
			const data = {
				_ts: [1000, 2000, 3000],
				price: [100, 101, 102]
			};

			const result = builder.setDataset(data, ['Time', 'Price']);
			expect(result).toBe(builder);
		});
	});

	describe('setDataset — array format', () => {
		it('accepts number[][] with dimension names', () => {
			const data = [
				[1000, 100, 500],
				[2000, 101, 600],
				[3000, 102, 700]
			];

			const result = builder.setDataset(data, ['_ts', 'price', 'volume']);
			expect(result).toBe(builder);
			expect(echarts.setOption).toHaveBeenCalled();
		});

		it('throws without dimension names for array data', () => {
			const data = [
				[1000, 100],
				[2000, 101]
			];

			expect(() => builder.setDataset(data)).toThrow('Requires yDimensionsNames');
		});

		it('throws when dimensions length does not match columns', () => {
			const data = [
				[1000, 100, 200],
				[2000, 101, 201]
			];

			expect(() => builder.setDataset(data, ['_ts', 'price'])).toThrow('Dimensions length');
		});

		it('throws with less than 2 rows', () => {
			const data = [[1000, 100]];
			expect(() => builder.setDataset(data, ['_ts', 'price'])).toThrow('Minimum data length is 2');
		});
	});

	describe('setDataset — object array format', () => {
		it('accepts Record<string, any>[]', () => {
			const data = [
				{ _ts: 1000, price: 100, ema: 99 },
				{ _ts: 2000, price: 101, ema: 100 },
				{ _ts: 3000, price: 102, ema: 101 }
			];

			const result = builder.setDataset(data);
			expect(result).toBe(builder);
			expect(echarts.setOption).toHaveBeenCalled();
		});

		it('throws with less than 2 rows', () => {
			const data = [{ _ts: 1000, price: 100 }];
			expect(() => builder.setDataset(data)).toThrow('Minimum data length is 2');
		});
	});

	describe('getDimensionKeys', () => {
		it('returns x and y dimension keys after setDataset', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101],
				ema: [99, 100]
			});

			const keys = builder.getDimensionKeys();
			expect(keys.x).toBe('_ts');
			expect(keys.y).toEqual(['price', 'ema']);
		});
	});

	describe('getTotalRows', () => {
		it('returns row count for simple object data', () => {
			builder.setDataset({
				_ts: [1000, 2000, 3000],
				price: [100, 101, 102]
			});

			expect(builder.getTotalRows()).toBe(3);
		});

		it('returns row count for array data', () => {
			builder.setDataset(
				[
					[1000, 100],
					[2000, 101],
					[3000, 102]
				],
				['_ts', 'price']
			);

			expect(builder.getTotalRows()).toBe(3);
		});

		it('returns row count for object array data', () => {
			builder.setDataset([
				{ _ts: 1000, price: 100 },
				{ _ts: 2000, price: 101 }
			]);

			expect(builder.getTotalRows()).toBe(2);
		});
	});

	describe('getRangeValues', () => {
		it('returns first and last timestamp for simple object', () => {
			builder.setDataset({
				_ts: [1000, 2000, 3000],
				price: [100, 101, 102]
			});

			expect(builder.getRangeValues()).toEqual([1000, 3000]);
		});

		it('returns first and last timestamp for array data', () => {
			builder.setDataset(
				[
					[1000, 100],
					[2000, 101],
					[3000, 102]
				],
				['_ts', 'price']
			);

			expect(builder.getRangeValues()).toEqual([1000, 3000]);
		});

		it('returns first and last timestamp for object array', () => {
			builder.setDataset([
				{ _ts: 1000, price: 100 },
				{ _ts: 2000, price: 101 },
				{ _ts: 3000, price: 102 }
			]);

			expect(builder.getRangeValues()).toEqual([1000, 3000]);
		});
	});

	describe('percentage field detection', () => {
		it('assigns percentage columns to secondary y-axis', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101],
				'change%': [0.5, -0.3]
			});

			const opts = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const series = opts.series;
			const priceSeries = series.find((s: any) => s.id === 'price');
			const pctSeries = series.find((s: any) => s.id === 'change%');

			expect(priceSeries.yAxisIndex).toBe(0);
			expect(pctSeries.yAxisIndex).toBe(1);
		});

		it('ignores underscore-prefixed percentage columns', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101],
				'_hidden%': [0.5, -0.3]
			});

			const opts = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const series = opts.series;
			const hiddenSeries = series.find((s: any) => s.id === '_hidden%');

			expect(hiddenSeries.yAxisIndex).toBe(0);
		});
	});

	describe('addDimension', () => {
		it('adds a new dimension to existing dataset', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101]
			});

			builder.addDimension({ ema: [99, 100] }, 'ema');
			expect(echarts.setOption).toHaveBeenCalledTimes(2);
		});
	});

	describe('fluent API — builder methods', () => {
		it('setTitle returns this', () => {
			expect(builder.setTitle('Test', 'Subtitle')).toBe(builder);
		});

		it('setLegendIcon returns this', () => {
			expect(builder.setLegendIcon('circle')).toBe(builder);
		});

		it('setAxisTooltip returns this', () => {
			expect(builder.setAxisTooltip()).toBe(builder);
		});

		it('setGrid returns this', () => {
			expect(builder.setGrid({ top: '5%' })).toBe(builder);
		});
	});

	describe('toggleLegend', () => {
		it('dispatches legendToggleSelect action', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101]
			});

			builder.toggleLegend('price');
			expect(echarts.dispatchAction).toHaveBeenCalledWith({
				type: 'legendToggleSelect',
				name: 'price'
			});
		});

		it('handles empty column gracefully', () => {
			const result = builder.toggleLegend('');
			expect(result).toBe(builder);
			expect(echarts.dispatchAction).not.toHaveBeenCalled();
		});
	});

	describe('addMarkerEvents', () => {
		it('adds marker line series', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101]
			});

			builder.addMarkerEvents([{ xAxis: [1000, 2000], color: 'red', name: 'Event' }]);

			const opts = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls;
			const lastCall = opts[opts.length - 1][0];
			const markerSeries = lastCall.series.filter((s: any) => s.markLine);

			expect(markerSeries.length).toBeGreaterThan(0);
		});
	});

	describe('addMarkerPoint', () => {
		it('adds marker point to existing dimension series', () => {
			builder.setDataset({
				_ts: [1000, 2000, 3000],
				price: [100, 101, 102]
			});

			builder.addMarkerPoint(
				0,
				{
					dimName: 'price',
					timestamp: 2000,
					name: 'Buy'
				},
				{ icon: 'pin', color: 'green' }
			);

			const opts = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const priceSeries = opts.series.find((s: any) => s.id === 'price');

			expect(priceSeries.markPoint).toBeDefined();
			expect(priceSeries.markPoint.data).toHaveLength(1);
			expect(priceSeries.markPoint.data[0].name).toBe('markerpoint-0');
		});
	});

	describe('setSeriesStyle', () => {
		it('applies style to all series', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101],
				ema: [99, 100]
			});

			builder.setSeriesStyle({ smooth: true });

			const opts = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls[0][0];
			for (const s of opts.series) {
				expect(s.smooth).toBe(true);
			}
		});
	});

	describe('getLegendStatus', () => {
		it('returns legend selected state', () => {
			builder.setDataset({
				_ts: [1000, 2000],
				price: [100, 101],
				ema: [99, 100]
			});

			const status = builder.getLegendStatus();
			expect(status).toHaveProperty('price');
			expect(status).toHaveProperty('ema');
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

		it('pushes a candlestick series with id "candlestick" and ECharts encode order [O,C,L,H]', () => {
			builder.setCandlestickSeries(data, dims);

			const opts = lastSetOptionCall(echarts)[0];
			const candle = opts.series.find((s: any) => s.id === 'candlestick');

			expect(candle).toBeDefined();
			expect(candle.type).toBe('candlestick');
			expect(candle.encode.x).toBe('_ts');
			// ECharts requires [open, close, low, high] in this exact order.
			expect(candle.encode.y).toEqual(['open', 'close', 'low', 'high']);
		});

		it('marks the candlestick legend entry as selected', () => {
			builder.setCandlestickSeries(data, dims);
			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
		});

		it('sets dataset.dimensions in the [_ts, O, H, L, C] order', () => {
			builder.setCandlestickSeries(data, dims);
			const opts = lastSetOptionCall(echarts)[0];
			expect(opts.dataset.dimensions).toEqual(['_ts', 'open', 'high', 'low', 'close']);
		});

		it('replaces (does not duplicate) the candlestick on a second call', () => {
			builder.setCandlestickSeries(data, dims);
			builder.setCandlestickSeries(data, dims);

			const opts = lastSetOptionCall(echarts)[0];
			const candles = opts.series.filter((s: any) => s.id === 'candlestick');
			expect(candles).toHaveLength(1);
		});

		it('exposes correct row count and range after rendering', () => {
			builder.setCandlestickSeries(data, dims);
			expect(builder.getTotalRows()).toBe(3);
			expect(builder.getRangeValues()).toEqual([1000, 3000]);
		});

		it('coexists with overlay dimensions added afterwards', () => {
			builder.setCandlestickSeries(data, dims);
			builder.addDimension({ ema: [103, 104, 105] }, 'ema');

			const opts = lastSetOptionCall(echarts)[0];
			expect(opts.series.find((s: any) => s.id === 'candlestick')).toBeDefined();
			expect(opts.series.find((s: any) => s.id === 'ema')).toBeDefined();
		});
	});

	describe('clearCandlestickSeries', () => {
		const dims = { open: 'open', high: 'high', low: 'low', close: 'close' };
		const data = {
			_ts: [1000, 2000],
			open: [100, 101],
			high: [105, 106],
			low: [99, 100],
			close: [104, 105]
		};

		it('removes the candlestick series and Candlestick legend entry', () => {
			builder.setCandlestickSeries(data, dims);
			builder.clearCandlestickSeries();

			const opts = lastSetOptionCall(echarts)[0];
			expect(opts.series.find((s: any) => s.id === 'candlestick')).toBeUndefined();
			expect(builder.getLegendStatus()).not.toHaveProperty('Candlestick');
		});

		it('uses replaceMerge:["dataset","series"] so ECharts drops the series from state', () => {
			builder.setCandlestickSeries(data, dims);
			builder.clearCandlestickSeries();

			const lastCall = lastSetOptionCall(echarts);
			expect(lastCall[1]).toEqual(expect.objectContaining({ replaceMerge: ['dataset', 'series'] }));
		});

		it('is a no-op when no candlestick was set', () => {
			const before = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls.length;
			builder.clearCandlestickSeries();
			const after = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls.length;
			expect(after).toBe(before);
		});
	});
});
