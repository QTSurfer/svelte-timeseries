import { describe, expect, it } from 'vitest';
import { aggregateCandles, parseCandleInterval } from '../../src/lib/candleAggregation';

const SECOND = 1000;
const MINUTE = 60_000;

describe('parseCandleInterval', () => {
	it('reads unit strings and plain milliseconds', () => {
		expect(parseCandleInterval('250ms')).toBe(250);
		expect(parseCandleInterval('1s')).toBe(1000);
		expect(parseCandleInterval('5s')).toBe(5000);
		expect(parseCandleInterval('1m')).toBe(60_000);
		expect(parseCandleInterval('15m')).toBe(900_000);
		expect(parseCandleInterval('4h')).toBe(14_400_000);
		expect(parseCandleInterval('1d')).toBe(86_400_000);
		expect(parseCandleInterval(1500)).toBe(1500);
	});

	it('rejects anything that is not a positive length', () => {
		for (const bad of [
			'',
			'0s',
			'1y',
			'1.5s',
			' 1s',
			'1 s',
			's',
			'-1s',
			0,
			-5,
			Number.NaN,
			Infinity
		]) {
			expect(() => parseCandleInterval(bad as never), String(bad)).toThrowError(RangeError);
		}
		expect(() => parseCandleInterval(undefined as never)).toThrowError(RangeError);
	});
});

describe('aggregateCandles', () => {
	it('takes open and close by time and high and low as extremes', () => {
		const bars = aggregateCandles(
			{ times: [0, 200, 400, 600, 800], values: [10, 14, 8, 12, 11] },
			'1s'
		);
		expect(bars).toEqual({
			times: [0],
			open: [10],
			high: [14],
			low: [8],
			close: [11]
		});
	});

	it('puts a tick exactly on a boundary in the bar that starts there', () => {
		const bars = aggregateCandles({ times: [999, 1000, 1999, 2000], values: [1, 2, 3, 4] }, '1s');
		expect(bars.times).toEqual([0, 1000, 2000]);
		expect(bars.open).toEqual([1, 2, 4]);
		expect(bars.close).toEqual([1, 3, 4]);
	});

	it('gives the same bars for a string interval and its milliseconds', () => {
		const times = Array.from({ length: 50 }, (_, i) => i * 7_000);
		const values = times.map((_, i) => 100 + Math.sin(i) * 5);
		const input = { times, values };
		expect(aggregateCandles(input, '1m')).toEqual(aggregateCandles(input, MINUTE));
		expect(aggregateCandles(input, '5s')).toEqual(aggregateCandles(input, 5 * SECOND));
	});

	it('skips empty buckets instead of drawing flat bars', () => {
		const bars = aggregateCandles({ times: [0, 10_000, 10_500], values: [1, 5, 6] }, '1s');
		expect(bars.times).toEqual([0, 10_000]);
		expect(bars.high).toEqual([1, 6]);
	});

	it('turns a single tick into one bar with open = high = low = close', () => {
		const bars = aggregateCandles({ times: [1234], values: [42.5] }, '1s');
		expect(bars).toEqual({ times: [1000], open: [42.5], high: [42.5], low: [42.5], close: [42.5] });
	});

	it('returns empty arrays for empty input', () => {
		expect(aggregateCandles({ times: [], values: [] }, '1m')).toEqual({
			times: [],
			open: [],
			high: [],
			low: [],
			close: []
		});
		expect(aggregateCandles({ times: [], values: [], volumes: [] }, '1m').volume).toEqual([]);
	});

	it('sorts unsorted input and keeps the input order of equal times', () => {
		const unsorted = aggregateCandles(
			{ times: [1500, 500, 1500, 500], values: [20, 1, 22, 3] },
			'1s'
		);
		expect(unsorted).toEqual(
			aggregateCandles({ times: [500, 500, 1500, 1500], values: [1, 3, 20, 22] }, '1s')
		);
		expect(unsorted.open).toEqual([1, 20]);
		expect(unsorted.close).toEqual([3, 22]);
	});

	it('skips ticks without a finite time or price', () => {
		const bars = aggregateCandles(
			{
				times: [0, Number.NaN, 100, 200, Infinity, 300],
				values: [5, 99, null, Number.NaN, 99, 7]
			},
			'1s'
		);
		expect(bars).toEqual({ times: [0], open: [5], high: [7], low: [5], close: [7] });
	});

	it('accepts typed arrays and reads up to the shortest array', () => {
		const bars = aggregateCandles(
			{ times: new Float64Array([0, 500, 1000, 1500]), values: new Float64Array([1, 2, 3]) },
			'1s'
		);
		expect(bars.times).toEqual([0, 1000]);
		expect(bars.close).toEqual([2, 3]);
	});

	it('floors times before 1970 into the bucket that contains them', () => {
		const bars = aggregateCandles({ times: [-1, -1000, -1001], values: [1, 2, 3] }, '1s');
		expect(bars.times).toEqual([-2000, -1000]);
	});

	it('aligns day bars to UTC midnight', () => {
		const noon = Date.UTC(2025, 0, 2, 12, 0, 0);
		const bars = aggregateCandles({ times: [noon, noon + 5 * 3_600_000], values: [1, 2] }, '1d');
		expect(bars.times).toEqual([Date.UTC(2025, 0, 2)]);
		const next = aggregateCandles({ times: [Date.UTC(2025, 0, 3, 0, 0, 0)], values: [1] }, '1d');
		expect(next.times).toEqual([Date.UTC(2025, 0, 3)]);
	});

	it('sums volumes per bar and ignores missing volumes', () => {
		const bars = aggregateCandles(
			{
				times: [0, 100, 1000, 1100, 2000],
				values: [1, 2, 3, 4, 5],
				volumes: [10, 5, null, 2, 7]
			},
			'1s'
		);
		expect(bars.volume).toEqual([15, 2, 7]);

		const shortVolumes = aggregateCandles({ times: [0, 1000], values: [1, 2], volumes: [4] }, '1s');
		expect(shortVolumes.volume).toEqual([4, 0]);
	});

	it('drops the volume of a tick that is skipped for its price', () => {
		const bars = aggregateCandles({ times: [0, 100], values: [1, null], volumes: [3, 100] }, '1s');
		expect(bars.volume).toEqual([3]);
	});

	it('has no volume key unless volumes were given', () => {
		expect('volume' in aggregateCandles({ times: [0], values: [1] }, '1s')).toBe(false);
	});

	it('throws on an invalid interval', () => {
		expect(() => aggregateCandles({ times: [0], values: [1] }, '1y' as never)).toThrowError(
			/Invalid candle interval/
		);
	});

	it('matches a straightforward reference on random ticks', () => {
		let seed = 12345;
		const random = () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
		const times: number[] = [];
		const values: number[] = [];
		let time = Date.UTC(2025, 5, 1);
		for (let i = 0; i < 5000; i++) {
			time += Math.floor(random() * 4000);
			times.push(time);
			values.push(Math.round((100 + random() * 10) * 100) / 100);
		}

		const step = 5 * SECOND;
		const reference = new Map<number, number[]>();
		times.forEach((t, i) => {
			const key = Math.floor(t / step) * step;
			reference.set(key, [...(reference.get(key) ?? []), values[i]]);
		});
		const expected = [...reference.entries()].sort((a, b) => a[0] - b[0]);

		const bars = aggregateCandles({ times, values }, '5s');
		expect(bars.times).toEqual(expected.map(([key]) => key));
		expect(bars.open).toEqual(expected.map(([, v]) => v[0]));
		expect(bars.close).toEqual(expected.map(([, v]) => v[v.length - 1]));
		expect(bars.high).toEqual(expected.map(([, v]) => Math.max(...v)));
		expect(bars.low).toEqual(expected.map(([, v]) => Math.min(...v)));
	});

	it('does not mutate its input', () => {
		const times = [2000, 0, 1000];
		const values = [3, 1, 2];
		aggregateCandles({ times, values }, '1s');
		expect(times).toEqual([2000, 0, 1000]);
		expect(values).toEqual([3, 1, 2]);
	});
});
