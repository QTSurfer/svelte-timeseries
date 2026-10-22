import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LightweightTimeSeriesChartBuilder,
	formatPreciseValue,
	getPricePrecision
} from '../../src/lib/LightweightTimeSeriesChartBuilder';
import { createSeriesMarkers } from 'lightweight-charts';

function createMockSeries() {
	const options: Record<string, unknown> = { visible: true };
	return {
		setData: vi.fn(),
		applyOptions: vi.fn((next: Record<string, unknown>) => Object.assign(options, next)),
		options: vi.fn(() => options)
	};
}

function createMockChart() {
	const visibleLogicalRange = { from: 0, to: 10 };
	const timeScale = {
		getVisibleLogicalRange: vi.fn(() => visibleLogicalRange),
		getVisibleRange: vi.fn(() => ({ from: 1, to: 3 })),
		setVisibleLogicalRange: vi.fn(),
		setVisibleRange: vi.fn(),
		fitContent: vi.fn(),
		timeToIndex: vi.fn((_time: number, _findNearest?: boolean): number | null => 0),
		subscribeVisibleTimeRangeChange: vi.fn(),
		unsubscribeVisibleTimeRangeChange: vi.fn()
	};

	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		addSeries: vi.fn((_definition?: unknown, _options?: any) => createMockSeries()),
		removeSeries: vi.fn(),
		applyOptions: vi.fn(),
		subscribeCrosshairMove: vi.fn(),
		unsubscribeCrosshairMove: vi.fn(),
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
		vi.clearAllMocks();
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

	it('infers a non-standard timestamp key from direct datasets', () => {
		builder.setDataset({
			time: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		expect(builder.getRangeValues()).toEqual([1000, 3000]);
		expect(chart.addSeries.mock.results[0].value.setData).toHaveBeenCalledWith([
			{ time: 1, value: 100 },
			{ time: 2, value: 101 },
			{ time: 3, value: 102 }
		]);
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

	it('preserves precision for micro-priced tokens and smaller values', () => {
		expect(getPricePrecision([null, 0.0000024675805])).toBe(13);
		expect(formatPreciseValue(0.0000024675805)).toBe('0.0000024675805');
		expect(formatPreciseValue(1.2e-18)).toBe('0.0000000000000000012');
		expect(formatPreciseValue(0)).toBe('0');
		expect(formatPreciseValue(100.25)).toBe('100.25');

		// 1.2e-18 alone would need precision 19, but lightweight-charts' own price
		// formatter throws for any precision outside 0-16 — getPricePrecision caps
		// there so the series can still render instead of crashing.
		builder.setDataset({ _ts: [1000, 2000], price: [0.0000024675805, 1.2e-18] });
		expect(chart.addSeries).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				priceFormat: { type: 'price', precision: 16, minMove: 1e-16 }
			})
		);
	});

	it('does not widen the price scale for floating-point noise', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100.1 + 0.2, 69574.62 + 0.01, 1.1 * 1.1]
		});

		expect(chart.addSeries).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
			})
		);
		expect(formatPreciseValue(100.1 + 0.2)).toBe('100.3');
	});

	it('updates precision when a new viewport contains smaller values', () => {
		builder.setDataset({ _ts: [1000, 2000], price: [1, 2] });
		const priceSeries = chart.addSeries.mock.results[0].value;

		builder.updateDimension({ _ts: [3000, 4000], price: [0.0000024675805, null] }, 'price');

		expect(priceSeries.applyOptions).toHaveBeenCalledWith({
			priceFormat: { type: 'price', precision: 13, minMove: 1e-13 }
		});
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

	it('renders null values as gaps and keeps hidden dimensions loaded', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102],
			ema: [null, null, 101]
		});
		const emaSeries = chart.addSeries.mock.results[1].value;

		builder.updateDimensions({ _ts: [2000, 3000], price: [101, 102], ema: [null, 101] }, [
			'price',
			'ema'
		]);

		expect(builder.getLoadedDimensions()).toEqual(['price', 'ema']);
		expect(builder.getLegendStatus()).toEqual({ price: true, ema: false });
		expect(emaSeries.setData).toHaveBeenLastCalledWith([{ time: 2 }, { time: 3, value: 101 }]);

		builder.toggleLegend('ema');
		expect(builder.getLegendStatus().ema).toBe(true);
		expect(emaSeries.applyOptions).toHaveBeenLastCalledWith({ visible: true });
	});

	it('passes the cross-engine "square" icon through as a native shape', () => {
		// 'square' is one of lightweight-charts' own native SeriesMarkerShape values (circle/
		// square/arrowUp/arrowDown) — the cross-engine-consistent set shared with ECharts (which
		// maps it onto its own 'rect' symbol, having no native 'square').
		builder.setDataset({
			_ts: [1000, 2000],
			price: [100, 101]
		});
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000 }, { icon: 'square' });

		const markersPlugin = vi.mocked(createSeriesMarkers).mock.results[0].value;
		expect(markersPlugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ shape: 'square' })
		]);
	});

	it('draws a circle when the icon is unset, "none" or empty, like the other engines', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 1000 });
		builder.addMarkerPoint(2, { dimName: 'price', timestamp: 2000 }, { icon: 'none' });
		builder.addMarkerPoint(3, { dimName: 'price', timestamp: 3000 }, { icon: '' });

		const markersPlugin = vi.mocked(createSeriesMarkers).mock.results[0].value;
		expect(markersPlugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ shape: 'circle' }),
			expect.objectContaining({ shape: 'circle' }),
			expect.objectContaining({ shape: 'circle' })
		]);
	});

	it('collapses an ECharts-only shape to "square", the closest native equivalent', () => {
		// 'pin' is one of ECharts' own extra symbol types (rect/roundRect/triangle/diamond/pin)
		// — lightweight-charts has no native equivalent for any of them, so they all fall back
		// to 'square' rather than rendering nothing or throwing.
		builder.setDataset({
			_ts: [1000, 2000],
			price: [100, 101]
		});
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000 }, { icon: 'pin' });

		const markersPlugin = vi.mocked(createSeriesMarkers).mock.results[0].value;
		expect(markersPlugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ shape: 'square' })
		]);
	});

	it('preserves visibility and markers when adding a dimension after a window update', () => {
		builder.setDataset({
			_ts: [1000, 2000],
			price: [100, 101]
		});
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000, name: 'Buy' });
		const markersPlugin = vi.mocked(createSeriesMarkers).mock.results[0].value;
		builder.toggleLegend('price');

		builder.updateDimensions({ _ts: [2000, 3000], price: [101, 102] }, ['price']);
		builder.addDimension({ ema: [100, 101] }, 'ema');

		expect(chart.addSeries).toHaveBeenCalledTimes(2);
		expect(chart.removeSeries).not.toHaveBeenCalled();
		expect(builder.getRangeValues()).toEqual([2000, 3000]);
		expect(builder.getLegendStatus()).toEqual({ price: false, ema: true });
		expect(createSeriesMarkers).toHaveBeenCalledTimes(2);
		expect(markersPlugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ text: 'Buy' })
		]);
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

		it('configures precision from all OHLC values', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);

			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000],
					open: [0.0000024675805, 0.0000024675805],
					high: [0.0000024675805, 0.0000024675805],
					low: [0.0000024675805, 0.000000000000001],
					close: [0.0000024675805, 0.0000024675805]
				},
				dims
			);

			expect(chart.addSeries).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					priceFormat: { type: 'price', precision: 15, minMove: 1e-15 }
				})
			);
		});

		it('caps precision at 16 instead of crashing on a near-zero DEX price', () => {
			// A dying pool's price crashing towards zero can produce a close with 20+
			// decimal digits. lightweight-charts throws `TypeError: invalid length` for
			// any priceFormat.precision outside 0-16, so this must clamp there rather
			// than pass through whatever getDecimalPrecision computes.
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);

			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000],
					open: [0.0000024675805, 0.0000024675805],
					high: [0.0000024675805, 0.0000024675805],
					low: [0.0000024675805, 1.2e-22],
					close: [0.0000024675805, 0.0000024675805]
				},
				dims
			);

			expect(chart.addSeries).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					priceFormat: { type: 'price', precision: 16, minMove: 1e-16 }
				})
			);
		});

		it('marks Candlestick as selected in the legend', () => {
			builder.setCandlestickSeries(data, dims);
			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
			expect(builder.getLoadedDimensions()).toEqual(['open', 'high', 'low', 'close']);
		});

		it('skips incomplete candles instead of converting nulls to zero', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);

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

			expect(candleSeries.setData).toHaveBeenLastCalledWith([
				{ time: 2, open: 101, high: 106, low: 100, close: 105 }
			]);
		});

		it('removes the previous candlestick before adding a new one on rebuild', () => {
			builder.setCandlestickSeries(data, dims);
			builder.setCandlestickSeries(data, dims);

			// First call: add 1 candle. Second call: removeSeries on the old one, then add a new one.
			expect(chart.removeSeries).toHaveBeenCalledTimes(1);
			expect(chart.addSeries).toHaveBeenCalledTimes(2);
		});

		it('updates the existing candlestick series during viewport reloads', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);
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

			expect(candleSeries.setData).toHaveBeenLastCalledWith([
				{ time: 2, open: 201, high: 206, low: 200, close: 205 },
				{ time: 3, open: 202, high: 207, low: 201, close: 206 }
			]);
			expect(chart.addSeries).toHaveBeenCalledTimes(1);
			expect(chart.removeSeries).not.toHaveBeenCalled();
			expect(builder.getLegendStatus()).toHaveProperty('Candlestick', true);
			expect(chart.timeScale().setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 10 });
		});

		it('updates precision when a viewport loads smaller OHLC values', () => {
			const candleSeries = createMockSeries();
			chart.addSeries.mockImplementationOnce(() => candleSeries);
			builder.setCandlestickSeries(data, dims);

			builder.updateDimensions(
				{
					_ts: [2000],
					open: [0.0000024675805],
					high: [0.0000024675805],
					low: [0.0000024675805],
					close: [0.0000024675805]
				},
				['open', 'high', 'low', 'close']
			);

			expect(candleSeries.applyOptions).toHaveBeenCalledWith({
				priceFormat: { type: 'price', precision: 13, minMove: 1e-13 }
			});
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

describe('LightweightTimeSeriesChartBuilder viewport API', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		chart = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
	});

	it('lets the time scale zoom out far enough for a dense series to fit', () => {
		expect(chart.applyOptions).toHaveBeenCalledWith({ timeScale: { minBarSpacing: 0.001 } });
	});

	it('shows all the data when a new dataset replaces the old one under the same name', () => {
		builder.setDataset({ _ts: [1000, 2000, 3000], price: [1, 2, 3] });
		chart.timeScale().fitContent.mockClear();
		chart.timeScale().setVisibleLogicalRange.mockClear();

		builder.setDataset({ _ts: [4000, 5000, 6000], price: [4, 5, 6] });

		expect(chart.timeScale().fitContent).toHaveBeenCalled();
		expect(chart.timeScale().setVisibleLogicalRange).not.toHaveBeenCalled();
	});

	it('keeps the view when only the values of a dataset are updated', () => {
		builder.setDataset({ _ts: [1000, 2000, 3000], price: [1, 2, 3] });
		chart.timeScale().fitContent.mockClear();

		builder.updateDimension({ _ts: [1000, 2000, 3000], price: [7, 8, 9] }, 'price');

		expect(chart.timeScale().fitContent).not.toHaveBeenCalled();
	});

	it('sets the visible range from epoch milliseconds', () => {
		builder.setVisibleRange(1_000_000, 2_500_000);
		expect(chart.timeScale().setVisibleRange).toHaveBeenLastCalledWith({ from: 1000, to: 2500 });
	});

	it('fits the content on demand', () => {
		builder.fitContent();
		expect(chart.timeScale().fitContent).toHaveBeenCalledTimes(1);
	});

	it('reports the crosshair with time in milliseconds and the first value under the cursor', () => {
		const handler = vi.fn();
		builder.onCrosshairMove(handler);
		const listener = chart.subscribeCrosshairMove.mock.calls[0][0];

		listener({
			time: 1700,
			point: { x: 12, y: 34 },
			seriesData: new Map([
				['empty', {}],
				['price', { value: 42.5 }]
			])
		});
		listener({ point: undefined, seriesData: new Map() });

		expect(handler).toHaveBeenNthCalledWith(1, {
			time: 1_700_000,
			price: 42.5,
			point: { x: 12, y: 34 }
		});
		expect(handler).toHaveBeenNthCalledWith(2, {});
	});

	it('takes a candle close as the price', () => {
		const handler = vi.fn();
		builder.onCrosshairMove(handler);
		const listener = chart.subscribeCrosshairMove.mock.calls[0][0];

		listener({ time: 60, seriesData: new Map([['Candlestick', { close: 9 }]]) });

		expect(handler).toHaveBeenCalledWith({ time: 60_000, price: 9 });
	});

	it('subscribes once, and unsubscribes when the last handler is removed', () => {
		const first = vi.fn();
		const second = vi.fn();
		const stopFirst = builder.onCrosshairMove(first);
		const stopSecond = builder.onCrosshairMove(second);
		expect(chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1);

		stopFirst();
		expect(chart.unsubscribeCrosshairMove).not.toHaveBeenCalled();
		stopSecond();
		expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
	});

	it('reports the visible range in milliseconds and ignores an empty range', () => {
		const handler = vi.fn();
		const stop = builder.onVisibleRangeChange(handler);
		const listener = chart.timeScale().subscribeVisibleTimeRangeChange.mock.calls[0][0];

		listener({ from: 10, to: 20 });
		listener(null);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ from: 10_000, to: 20_000 });

		stop();
		expect(chart.timeScale().unsubscribeVisibleTimeRangeChange).toHaveBeenCalledTimes(1);
	});

	it('advertises the viewport capabilities', () => {
		expect(builder.capabilities).toMatchObject({
			crosshairEvents: true,
			visibleRangeEvents: true,
			viewport: true
		});
	});
});

describe('LightweightTimeSeriesChartBuilder price decimals', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;
	const noisy = { _ts: [1000, 2000, 3000], price: [48000, 48000.5, 48000.123456789] };
	const precisionOfLine = () => {
		const series = chart.addSeries.mock.results[0].value;
		return series.applyOptions.mock.calls
			.map((call: unknown[]) => (call[0] as { priceFormat?: { precision: number } }).priceFormat)
			.filter(Boolean)
			.at(-1)?.precision;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		chart = createMockChart();
	});

	it('follows the data by default, so one long value widens the axis', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setDataset(noisy);
		expect(chart.addSeries.mock.calls[0][1].priceFormat.precision).toBe(9);
	});

	it('uses the fixed decimals from the options', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never, { priceDecimals: 2 });
		builder.setDataset(noisy);
		expect(chart.addSeries.mock.calls[0][1].priceFormat).toEqual({
			type: 'price',
			precision: 2,
			minMove: 0.01
		});
	});

	it('changes the decimals of a drawn series and gives them back to the data', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setDataset(noisy);
		builder.setPriceDecimals(1);
		expect(precisionOfLine()).toBe(1);
		builder.setPriceDecimals(undefined);
		expect(precisionOfLine()).toBe(9);
	});

	it('applies the fixed decimals to candles and keeps them within 0 to 16', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never, { priceDecimals: 99 });
		builder.setCandlestickSeries(
			{ _ts: [1000, 2000], open: [1.123456, 2], high: [3, 4], low: [0.5, 1], close: [2, 3] },
			{ open: 'open', high: 'high', low: 'low', close: 'close' }
		);
		expect(chart.addSeries.mock.calls[0][1].priceFormat.precision).toBe(16);
		builder.setPriceDecimals(-3);
		const candles = chart.addSeries.mock.results[0].value;
		expect(candles.applyOptions).toHaveBeenLastCalledWith({
			priceFormat: { type: 'price', precision: 0, minMove: 1 }
		});
	});
});

describe('LightweightTimeSeriesChartBuilder price decimals', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;
	const noisy = { _ts: [1000, 2000, 3000], price: [48000, 48000.5, 48000.123456789] };
	const lastPrecision = () => {
		const series = chart.addSeries.mock.results[0].value;
		return series.applyOptions.mock.calls
			.map((call: unknown[]) => (call[0] as { priceFormat?: { precision: number } }).priceFormat)
			.filter(Boolean)
			.at(-1)?.precision;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		chart = createMockChart();
	});

	it('follows the data by default, so one long value widens the axis', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setDataset(noisy);
		expect(chart.addSeries.mock.calls[0][1].priceFormat.precision).toBe(9);
	});

	it('uses the fixed decimals from the options', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never, { priceDecimals: 2 });
		builder.setDataset(noisy);
		expect(chart.addSeries.mock.calls[0][1].priceFormat).toEqual({
			type: 'price',
			precision: 2,
			minMove: 0.01
		});
	});

	it('changes the decimals of a drawn series and gives them back to the data', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setDataset(noisy);
		builder.setPriceDecimals(1);
		expect(lastPrecision()).toBe(1);
		builder.setPriceDecimals(undefined);
		expect(lastPrecision()).toBe(9);
	});

	it('applies the fixed decimals to candles and keeps them within 0 to 16', () => {
		builder = new LightweightTimeSeriesChartBuilder(chart as never, { priceDecimals: 99 });
		builder.setCandlestickSeries(
			{ _ts: [1000, 2000], open: [1.123456, 2], high: [3, 4], low: [0.5, 1], close: [2, 3] },
			{ open: 'open', high: 'high', low: 'low', close: 'close' }
		);
		expect(chart.addSeries.mock.calls[0][1].priceFormat.precision).toBe(16);
		builder.setPriceDecimals(-3);
		const candles = chart.addSeries.mock.results[0].value;
		expect(candles.applyOptions).toHaveBeenLastCalledWith({
			priceFormat: { type: 'price', precision: 0, minMove: 1 }
		});
	});
});

describe('LightweightTimeSeriesChartBuilder legend items', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		chart = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
	});

	it('advertises the legend capability', () => {
		expect(builder.capabilities.legend).toBe(true);
	});

	it('lists the series with their color and visibility, and tells the handler at once', () => {
		builder.setDataset({ _ts: [1000, 2000], price: [1, 2] });
		const handler = vi.fn();
		builder.onLegendChange(handler);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0][0]).toEqual([
			expect.objectContaining({ name: 'price', visible: true })
		]);
	});

	it('stops calling a handler that was removed', () => {
		builder.setDataset({ _ts: [1000, 2000], price: [1, 2] });
		const handler = vi.fn();
		const stop = builder.onLegendChange(handler);
		handler.mockClear();
		stop();
		builder.toggleLegend('price');
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('LightweightTimeSeriesChartBuilder price format at 11 decimals', () => {
	// lightweight-charts needs minMove * 10 ** precision to be exactly 1; 10 ** -11 does not give it.
	const exact = (format: { precision: number; minMove: number }) =>
		format.minMove * Math.pow(10, format.precision) === 1;

	it('gives a line series a minMove the chart formatter can use', () => {
		const chart = createMockChart();
		const builder = new LightweightTimeSeriesChartBuilder(chart as never, { priceDecimals: 11 });
		builder.setDataset({ _ts: [1000, 2000], price: [3.96e-8, 1e-7] });
		expect(exact(chart.addSeries.mock.calls[0][1].priceFormat)).toBe(true);
	});

	it('gives the candles one, and keeps it when the decimals change later', () => {
		const chart = createMockChart();
		const builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setCandlestickSeries(
			{ _ts: [1000, 2000], open: [1, 2], high: [3, 4], low: [0.5, 1], close: [2, 3] },
			{ open: 'open', high: 'high', low: 'low', close: 'close' }
		);
		builder.setPriceDecimals(11);
		const candles = chart.addSeries.mock.results[0].value;
		const format = candles.applyOptions.mock.lastCall[0].priceFormat;
		expect(format.precision).toBe(11);
		expect(exact(format)).toBe(true);
	});

	it('gives an injected series one when its decimals change', () => {
		const chart = createMockChart();
		const builder = new LightweightTimeSeriesChartBuilder(chart as never);
		builder.setDataset({ _ts: [1000, 2000], price: [1, 2] });
		builder.setPriceDecimals(11);
		const line = chart.addSeries.mock.results[0].value;
		expect(exact(line.applyOptions.mock.lastCall[0].priceFormat)).toBe(true);
	});
});
