import { describe, expect, it, vi } from 'vitest';
import type { TimeSeriesChartAdapter } from '../../src/lib/chartAdapter';
import {
	applyPriceData,
	priceSignature,
	resolvePriceData,
	type CandlesInput
} from '../../src/lib/priceInput';

describe('resolvePriceData: line', () => {
	it('builds a dataset from parallel arrays', () => {
		const { data, issues } = resolvePriceData({ times: [1000, 2000], values: [10, 20] });
		expect(issues).toEqual([]);
		expect(data).toMatchObject({ mode: 'line', dimension: 'price', signature: 'line:price' });
		expect(data.mode === 'line' && data.dataset).toEqual({ _ts: [1000, 2000], price: [10, 20] });
	});

	it('builds a dataset from [time, value] pairs', () => {
		const { data } = resolvePriceData({
			name: 'BTC',
			points: [
				[1000, 10],
				[2000, null]
			]
		});
		expect(data.mode === 'line' && data.dataset).toEqual({ _ts: [1000, 2000], BTC: [10, null] });
	});

	it('accepts typed arrays and turns NaN into gaps', () => {
		const { data } = resolvePriceData({
			times: new Float64Array([1000, 2000, 3000]),
			values: new Float64Array([1, Number.NaN, 3])
		});
		expect(data.mode === 'line' && data.dataset.price).toEqual([1, null, 3]);
	});

	it('sorts unsorted input and drops points without a finite time', () => {
		const { data } = resolvePriceData({ times: [3000, Number.NaN, 1000], values: [3, 9, 1] });
		expect(data.mode === 'line' && data.dataset).toEqual({ _ts: [1000, 3000], price: [1, 3] });
	});

	it('names the series after the name option', () => {
		const { data } = resolvePriceData({ name: 'ETH', times: [1], values: [1] });
		expect(data.signature).toBe('line:ETH');
		expect(priceSignature({ name: 'ETH', times: [1], values: [1] })).toBe('line:ETH');
	});

	it('reports a missing array instead of throwing', () => {
		const { data, issues } = resolvePriceData({ times: [1] } as never);
		expect(data.mode).toBe('none');
		expect(issues).toHaveLength(1);
	});
});

describe('resolvePriceData: candles', () => {
	const candles: CandlesInput = {
		times: [1000, 2000, 3000],
		open: [1, 2, 3],
		high: [2, 3, 4],
		low: [0, 1, 2],
		close: [1.5, 2.5, 3.5]
	};

	it('builds an OHLC dataset', () => {
		const { data } = resolvePriceData(undefined, candles);
		expect(data).toMatchObject({
			mode: 'candles',
			dims: { open: 'open', high: 'high', low: 'low', close: 'close' },
			signature: 'candles'
		});
		expect(data.mode === 'candles' && data.dataset).toEqual({
			_ts: [1000, 2000, 3000],
			open: [1, 2, 3],
			high: [2, 3, 4],
			low: [0, 1, 2],
			close: [1.5, 2.5, 3.5]
		});
	});

	it('keeps rows with a missing field as nulls for the builder to skip', () => {
		const { data } = resolvePriceData(undefined, { ...candles, high: [2, null, 4] });
		expect(data.mode === 'candles' && data.dataset.high).toEqual([2, null, 4]);
	});

	it('sorts rows as a whole when the times are unsorted', () => {
		const { data } = resolvePriceData(undefined, {
			times: [2000, 1000],
			open: [2, 1],
			high: [3, 2],
			low: [1, 0],
			close: [2.5, 1.5]
		});
		expect(data.mode === 'candles' && data.dataset.open).toEqual([1, 2]);
		expect(data.mode === 'candles' && data.dataset.close).toEqual([1.5, 2.5]);
	});

	it('wins over a price line and says so', () => {
		const { data, issues } = resolvePriceData({ times: [1], values: [1] }, candles);
		expect(data.mode).toBe('candles');
		expect(issues[0]).toContain('only the candles');
		expect(priceSignature({ times: [1], values: [1] }, candles)).toBe('candles');
	});
});

describe('resolvePriceData: candles aggregated from a price line', () => {
	const ticks = {
		times: [0, 400, 900, 1000, 1500, 3000],
		values: [10, 12, 9, 11, 13, 20]
	};

	it('aggregates the ticks into the same dataset OHLC arrays would give', () => {
		const { data, issues } = resolvePriceData(undefined, { ...ticks, interval: '1s' });
		expect(issues).toEqual([]);
		expect(data).toMatchObject({ mode: 'candles', signature: 'candles' });
		expect(data.mode === 'candles' && data.dataset).toEqual({
			_ts: [0, 1000, 3000],
			open: [10, 11, 20],
			high: [12, 13, 20],
			low: [9, 11, 20],
			close: [9, 13, 20]
		});
		expect(data).toEqual(
			resolvePriceData(undefined, {
				times: [0, 1000, 3000],
				open: [10, 11, 20],
				high: [12, 13, 20],
				low: [9, 11, 20],
				close: [9, 13, 20]
			}).data
		);
	});

	it('shares the candles signature, so changing the interval updates in place', () => {
		expect(priceSignature(undefined, { ...ticks, interval: '1s' })).toBe('candles');
		expect(priceSignature(undefined, { ...ticks, interval: '1m' })).toBe('candles');
	});

	it('reports an invalid interval instead of throwing', () => {
		const { data, issues } = resolvePriceData(undefined, { ...ticks, interval: '1y' as never });
		expect(data.mode).toBe('none');
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('Invalid candle interval');
	});

	it('reports missing arrays', () => {
		const { data, issues } = resolvePriceData(undefined, { times: [1], interval: '1s' } as never);
		expect(data.mode).toBe('none');
		expect(issues[0]).toContain('times and values');
	});

	it('still wins over a price line', () => {
		const { data, issues } = resolvePriceData(
			{ times: [1], values: [1] },
			{ ...ticks, interval: 1000 }
		);
		expect(data.mode).toBe('candles');
		expect(issues[0]).toContain('only the candles');
	});
});

describe('resolvePriceData: nothing', () => {
	it('resolves to none without input', () => {
		expect(resolvePriceData().data).toEqual({ mode: 'none', signature: 'none' });
		expect(priceSignature()).toBe('none');
	});
});

function createAdapter(withUpdateDimensions = true) {
	const adapter = {
		setDataset: vi.fn().mockReturnThis(),
		setCandlestickSeries: vi.fn().mockReturnThis(),
		updateDimension: vi.fn().mockReturnThis(),
		...(withUpdateDimensions ? { updateDimensions: vi.fn().mockReturnThis() } : {})
	};
	return adapter as unknown as TimeSeriesChartAdapter & typeof adapter;
}

describe('applyPriceData', () => {
	const line = resolvePriceData({ times: [1000, 2000], values: [1, 2] }).data;
	const lineMore = resolvePriceData({ times: [1000, 2000, 3000], values: [1, 2, 3] }).data;
	const candles = resolvePriceData(undefined, {
		times: [1000],
		open: [1],
		high: [2],
		low: [0],
		close: [1]
	}).data;

	it('builds the series the first time', () => {
		const adapter = createAdapter();
		expect(applyPriceData(adapter, line)).toBe('created');
		expect(adapter.setDataset).toHaveBeenCalledWith(expect.objectContaining({ price: [1, 2] }), [
			'_ts',
			'price'
		]);
	});

	it('builds candles through the candlestick entry', () => {
		const adapter = createAdapter();
		applyPriceData(adapter, candles);
		expect(adapter.setCandlestickSeries).toHaveBeenCalledWith(
			expect.objectContaining({ open: [1] }),
			candles.mode === 'candles' ? candles.dims : undefined
		);
	});

	it('updates in place when only the values change', () => {
		const adapter = createAdapter();
		expect(applyPriceData(adapter, lineMore, line)).toBe('updated');
		expect(adapter.setDataset).not.toHaveBeenCalled();
		expect(adapter.updateDimensions).toHaveBeenCalledWith(
			expect.objectContaining({ price: [1, 2, 3] }),
			['price']
		);
	});

	it('updates every OHLC column for candles', () => {
		const adapter = createAdapter();
		applyPriceData(adapter, candles, candles);
		expect(adapter.updateDimensions).toHaveBeenCalledWith(expect.anything(), [
			'open',
			'high',
			'low',
			'close'
		]);
	});

	it('falls back to one update per column when the adapter has no bulk update', () => {
		const adapter = createAdapter(false);
		applyPriceData(adapter, candles, candles);
		expect(adapter.updateDimension).toHaveBeenCalledTimes(4);
	});

	it('rebuilds when the kind or the name changes', () => {
		const adapter = createAdapter();
		expect(applyPriceData(adapter, candles, line)).toBe('created');
		const renamed = resolvePriceData({ name: 'other', times: [1], values: [1] }).data;
		expect(applyPriceData(adapter, renamed, line)).toBe('created');
		expect(adapter.updateDimensions).not.toHaveBeenCalled();
	});

	it('does nothing without price data', () => {
		const adapter = createAdapter();
		expect(applyPriceData(adapter, { mode: 'none', signature: 'none' }, line)).toBe('none');
		expect(adapter.setDataset).not.toHaveBeenCalled();
		expect(adapter.updateDimensions).not.toHaveBeenCalled();
	});
});
