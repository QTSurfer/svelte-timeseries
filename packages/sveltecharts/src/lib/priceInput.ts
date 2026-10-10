/**
 * The "price data from arrays" entry: a line from parallel arrays (or `[time, value]` pairs) or
 * candles from OHLC arrays are converted to the dataset form the chart builders consume, without
 * any DuckDB involvement. Pure and unit-testable apart from `applyPriceData`, which only talks to
 * a `TimeSeriesChartAdapter`.
 */
import type {
	ChartDatasetFormatSimpleObject,
	OHLCDimensions,
	TimeSeriesChartAdapter
} from './chartAdapter';
import { aggregateCandles, type TickCandlesInput } from './candleAggregation';
import { toSortedColumns, type NumericArray } from './seriesInput';

/** A price line. Give either parallel `times` / `values` arrays or `points`. */
export type PriceLineInput = {
	/** Series title. Default `'price'`. */
	name?: string;
} & (
	| {
			/** Epoch milliseconds, ascending (unsorted input is sorted for you). */
			times: NumericArray;
			/** `null` / `NaN` leaves a gap. Typed arrays are fine. */
			values: NumericArray;
			points?: never;
	  }
	| {
			/** `[epochMilliseconds, value]` pairs. A `null` value leaves a gap. */
			points: ReadonlyArray<readonly [number, number | null | undefined]>;
			times?: never;
			values?: never;
	  }
);

/** Candles from parallel OHLC arrays. Rows with a missing field are not drawn. */
export type CandlesInput = {
	/** Epoch milliseconds of the start of each bar. */
	times: NumericArray;
	open: NumericArray;
	high: NumericArray;
	low: NumericArray;
	close: NumericArray;
};

/** What `candles` accepts: OHLC arrays, or a price line to aggregate into bars (`TickCandlesInput`). */
export type CandlesSource = CandlesInput | TickCandlesInput;

export const DEFAULT_PRICE_NAME = 'price';
const TIME_COLUMN = '_ts';
export const CANDLE_DIMENSIONS: OHLCDimensions = {
	open: 'open',
	high: 'high',
	low: 'low',
	close: 'close'
};

export type ResolvedPriceData =
	| { mode: 'none'; signature: 'none' }
	| {
			mode: 'line';
			dimension: string;
			dataset: ChartDatasetFormatSimpleObject;
			signature: string;
	  }
	| {
			mode: 'candles';
			dims: OHLCDimensions;
			dataset: ChartDatasetFormatSimpleObject;
			signature: string;
	  };

/**
 * Cheap identity of the price input: it changes only when the chart has to be rebuilt (a different
 * mode or series name), never when the values change. Does not read the arrays.
 */
export function priceSignature(
	price?: PriceLineInput | null,
	candles?: CandlesSource | null
): string {
	if (candles) return 'candles';
	if (price) return `line:${price.name || DEFAULT_PRICE_NAME}`;
	return 'none';
}

function toNullable(values: Float64Array): (number | null)[] {
	const result: (number | null)[] = new Array(values.length);
	for (let i = 0; i < values.length; i++) {
		result[i] = Number.isNaN(values[i]) ? null : values[i];
	}
	return result;
}

/**
 * Validates the price inputs and converts them to a dataset. `candles` wins when both are given.
 * Never throws: invalid input resolves to `mode: 'none'` plus an issue to report.
 */
export function resolvePriceData(
	price?: PriceLineInput | null,
	candles?: CandlesSource | null
): { data: ResolvedPriceData; issues: string[] } {
	const issues: string[] = [];

	if (candles) {
		if (price) issues.push('Both "candles" and "price" were given; only the candles are drawn.');
		if (isTickCandles(candles)) {
			if (!isArrayLike(candles.times) || !isArrayLike(candles.values)) {
				issues.push('"candles" with an "interval" needs array-like times and values.');
				return { data: { mode: 'none', signature: 'none' }, issues };
			}
			try {
				return { data: resolveCandles(aggregateCandles(candles, candles.interval)), issues };
			} catch (error) {
				issues.push(`"candles": ${error instanceof Error ? error.message : String(error)}`);
				return { data: { mode: 'none', signature: 'none' }, issues };
			}
		}
		if (
			![candles.times, candles.open, candles.high, candles.low, candles.close].every(isArrayLike)
		) {
			issues.push('"candles" needs array-like times, open, high, low and close.');
			return { data: { mode: 'none', signature: 'none' }, issues };
		}
		return { data: resolveCandles(candles), issues };
	}

	if (price) {
		const times: NumericArray | undefined = price.points
			? price.points.map((point) => point?.[0])
			: price.times;
		const values: NumericArray | undefined = price.points
			? price.points.map((point) => point?.[1])
			: price.values;
		if (!isArrayLike(times) || !isArrayLike(values)) {
			issues.push('"price" needs either "times" and "values" arrays or "points".');
			return { data: { mode: 'none', signature: 'none' }, issues };
		}
		if (times.length !== values.length) {
			issues.push(
				`"price" has ${times.length} times but ${values.length} values; only the common prefix is drawn.`
			);
		}
		const dimension = price.name || DEFAULT_PRICE_NAME;
		const columns = toSortedColumns(times, values);
		return {
			data: {
				mode: 'line',
				dimension,
				dataset: {
					[TIME_COLUMN]: Array.from(columns.times),
					[dimension]: toNullable(columns.values)
				},
				signature: `line:${dimension}`
			},
			issues
		};
	}

	return { data: { mode: 'none', signature: 'none' }, issues };
}

function resolveCandles(candles: CandlesInput): ResolvedPriceData {
	const count = Math.min(
		candles.times.length,
		candles.open.length,
		candles.high.length,
		candles.low.length,
		candles.close.length
	);

	const rows: number[] = [];
	let sorted = true;
	let previous = -Infinity;
	for (let i = 0; i < count; i++) {
		const time = candles.times[i];
		if (typeof time !== 'number' || !Number.isFinite(time)) continue;
		if (time < previous) sorted = false;
		previous = time;
		rows.push(i);
	}
	if (!sorted) {
		const times = candles.times;
		rows.sort((a, b) => (times[a] as number) - (times[b] as number) || a - b);
	}

	const column = (source: NumericArray): (number | null)[] =>
		rows.map((row) => {
			const value = source[row];
			return typeof value === 'number' && Number.isFinite(value) ? value : null;
		});

	return {
		mode: 'candles',
		dims: CANDLE_DIMENSIONS,
		dataset: {
			[TIME_COLUMN]: rows.map((row) => candles.times[row] as number),
			open: column(candles.open),
			high: column(candles.high),
			low: column(candles.low),
			close: column(candles.close)
		},
		signature: 'candles'
	};
}

function isTickCandles(candles: CandlesSource): candles is TickCandlesInput {
	return (candles as TickCandlesInput).interval !== undefined;
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
	return value != null && typeof (value as ArrayLike<unknown>).length === 'number';
}

/**
 * Applies resolved price data to an adapter. Same mode and same series name as `previous` updates
 * the data in place (the visible range is kept); anything else builds the series from scratch.
 * Returns what happened. `'none'` does nothing: removing the price input needs a new chart.
 */
export function applyPriceData(
	adapter: TimeSeriesChartAdapter,
	next: ResolvedPriceData,
	previous?: ResolvedPriceData
): 'created' | 'updated' | 'none' {
	if (next.mode === 'none') return 'none';

	const dimensions = next.mode === 'line' ? [next.dimension] : Object.values(next.dims);

	if (previous && previous.mode === next.mode && previous.signature === next.signature) {
		if (adapter.updateDimensions) {
			adapter.updateDimensions(next.dataset, dimensions);
		} else {
			for (const dimension of dimensions) adapter.updateDimension(next.dataset, dimension);
		}
		return 'updated';
	}

	if (next.mode === 'line') {
		adapter.setDataset(next.dataset, Object.keys(next.dataset));
	} else {
		adapter.setCandlestickSeries(next.dataset, next.dims);
	}
	return 'created';
}
