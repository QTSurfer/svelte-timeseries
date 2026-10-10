/**
 * Aggregation of a price line (ticks, trades, a ticker's last price) into OHLC bars. Pure: no
 * chart, no DOM.
 *
 * Use it when the data you hold is a price per instant and you want candles of a fixed length.
 * It is also what to use for a ticker feed, whose `open` / `high` / `low` columns describe a
 * rolling 24-hour window and so are not the prices of the bar: aggregate the *last price* instead.
 */
import type { CandlesInput } from './priceInput';
import type { NumericArray } from './seriesInput';

/**
 * Length of a bar: a number of milliseconds, or `<n>ms`, `<n>s`, `<n>m`, `<n>h`, `<n>d` such as
 * `'1s'`, `'5s'`, `'1m'`, `'15m'`, `'4h'`, `'1d'`.
 */
export type CandleInterval = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

/** A price per instant. Times are epoch milliseconds. */
export type PriceTicks = {
	/** Epoch milliseconds. Unsorted input is sorted (stable: equal times keep their input order). */
	times: NumericArray;
	/** Price per tick. A tick whose time or price is not a finite number is skipped. */
	values: NumericArray;
	/**
	 * Optional volume traded at each tick, summed per bar into `volume`. It must be per-tick (the
	 * size of each trade), not a running total such as a ticker's rolling 24-hour volume.
	 */
	volumes?: NumericArray;
};

/** Ticks to aggregate on the spot: what `candles` accepts as an alternative to OHLC arrays. */
export type TickCandlesInput = PriceTicks & {
	/** Bar length, see {@link CandleInterval}. */
	interval: CandleInterval;
};

/** OHLC bars as parallel arrays, ready to be given as `candles`. */
export type AggregatedCandles = CandlesInput & {
	/** Sum of the tick volumes in each bar. Only present when `volumes` was given. */
	volume?: number[];
};

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Bar length in milliseconds. Throws a `RangeError` for anything that is not a positive length. */
export function parseCandleInterval(interval: CandleInterval): number {
	if (typeof interval === 'number') {
		if (Number.isFinite(interval) && interval > 0) return interval;
	} else if (typeof interval === 'string') {
		const match = /^(\d+)(ms|s|m|h|d)$/.exec(interval);
		if (match) {
			const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
			if (ms > 0) return ms;
		}
	}
	throw new RangeError(
		`Invalid candle interval ${JSON.stringify(interval)}. Use milliseconds or a string such as "1s", "5m", "1h", "1d".`
	);
}

/**
 * Aggregates a price line into OHLC bars of a fixed length.
 *
 * - Each bar covers `[start, start + interval)` and its time is `start`. Bars are aligned to the
 *   Unix epoch (UTC): epoch milliseconds are divided into whole buckets, no time zone is applied.
 *   For lengths that divide a day (`'1s'` ... `'12h'`, `'1d'`) this is the same grid as DuckDB's
 *   `time_bucket`. Longer lengths such as `'7d'` count from 1970-01-01, which can differ from the
 *   origin a SQL engine picks.
 * - open is the first tick of the bar, close the last, high and low the extremes, by time (ties
 *   keep input order).
 * - Buckets without ticks are skipped, so quiet periods stay gaps rather than flat bars.
 * - One tick gives one bar with open = high = low = close.
 * - Unsorted input is sorted by time first, like the `price` input. Ticks whose time or price is
 *   not finite (`null`, `NaN`) are skipped, together with their volume.
 * - Arrays of different lengths are read up to the shortest one.
 * - Empty input gives empty arrays.
 *
 * Throws a `RangeError` when `interval` is not a positive length.
 */
export function aggregateCandles(ticks: PriceTicks, interval: CandleInterval): AggregatedCandles {
	const step = parseCandleInterval(interval);
	const { times, values, volumes } = ticks;
	const count = Math.min(times.length, values.length);

	const rows: number[] = [];
	let sorted = true;
	let previous = -Infinity;
	for (let i = 0; i < count; i++) {
		const time = times[i];
		const value = values[i];
		if (typeof time !== 'number' || !Number.isFinite(time)) continue;
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		if (time < previous) sorted = false;
		previous = time;
		rows.push(i);
	}
	if (!sorted) {
		rows.sort((a, b) => (times[a] as number) - (times[b] as number) || a - b);
	}

	const result: AggregatedCandles = { times: [], open: [], high: [], low: [], close: [] };
	const barTimes = result.times as number[];
	const open = result.open as number[];
	const high = result.high as number[];
	const low = result.low as number[];
	const close = result.close as number[];
	const volume: number[] | undefined = volumes ? [] : undefined;

	let current = NaN;
	let last = -1;
	for (const row of rows) {
		const price = values[row] as number;
		const start = Math.floor((times[row] as number) / step) * step;
		if (start !== current) {
			current = start;
			last++;
			barTimes.push(start);
			open.push(price);
			high.push(price);
			low.push(price);
			close.push(price);
			volume?.push(0);
		} else {
			if (price > high[last]) high[last] = price;
			if (price < low[last]) low[last] = price;
			close[last] = price;
		}
		if (volume) {
			const traded = volumes?.[row];
			if (typeof traded === 'number' && Number.isFinite(traded)) volume[last] += traded;
		}
	}

	if (volume) result.volume = volume;
	return result;
}
