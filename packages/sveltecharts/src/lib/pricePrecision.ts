import type { ChartDataValue } from './chartAdapter';

const DEFAULT_PRICE_PRECISION = 2;
// Cap for display-only precision (formatPreciseValue) — just a sanity bound, not tied
// to any chart library limit.
const MAX_DISPLAY_PRECISION = 30;
// lightweight-charts' own price formatter throws `TypeError: invalid length` for any
// priceFormat.precision outside 0-16. getPricePrecision feeds that option directly, so
// it must cap here — otherwise a candle with an extreme number of decimals (e.g. a
// near-zero DEX price) produces a precision the chart itself rejects, crashing the
// whole series render.
const MAX_CHART_PRECISION = 16;

// A double holds about 16 significant digits. A value whose shortest exact representation uses
// fewer than 15 is taken at face value, every digit meant (the common case: prices quoted with a
// few decimals). One that uses 15 to 17 is usually the result of arithmetic (`0.1 + 0.2`, a sum,
// a ratio) and carries floating-point noise in its last digits, which must not widen the scale.
const NOISE_DIGITS = 15;
// For such a value the decimals shown are the fewest at which it still equals itself within this
// relative distance: about 450 units in the last place, far above the noise of the arithmetic that
// produces it (a thousand additions stay below it) and far below anything visible (13 significant
// digits are kept). Values stored as 32-bit floats are not rounded away either: their error
// (about 1e-7) is real representation error, not floating-point noise.
const NOISE_TOLERANCE = 1e-13;

/** Decimals of the shortest exact decimal representation, and how many significant digits it has. */
function shortestRepresentation(abs: number): { decimals: number; digits: number } {
	const [mantissa, exponentPart] = abs.toString().split('e');
	const [integer, fraction = ''] = mantissa.split('.');
	const characters = integer.length + fraction.length;
	return {
		decimals: fraction.length - Number(exponentPart ?? 0),
		// Leading and trailing zeros are not significant. Short strings cannot reach the noise
		// threshold, so they skip the count.
		digits:
			characters < NOISE_DIGITS
				? characters
				: (integer + fraction).replace(/^0+/, '').replace(/0+$/, '').length
	};
}

// Exact powers of ten (10 ** 22 is the largest a double represents exactly).
const POWERS_OF_TEN = Array.from({ length: 23 }, (_, power) => 10 ** power);

/** Whether `abs` rounded to `decimals` decimals is still `abs` within `NOISE_TOLERANCE`. */
function equalsAtDecimals(abs: number, decimals: number): boolean {
	const scale = POWERS_OF_TEN[decimals];
	const scaled = scale === undefined ? Infinity : abs * scale;
	// Arithmetic rounding while the scaled value is an exact integer range (the fast path: this
	// runs once per value of a noisy series); the exact decimal expansion otherwise.
	const rounded =
		scaled < Number.MAX_SAFE_INTEGER ? Math.round(scaled) / scale : Number(abs.toFixed(decimals));
	return Math.abs(rounded - abs) <= NOISE_TOLERANCE * abs;
}

/**
 * Decimals needed to show `value`. `floor` is a number of decimals already needed by other values:
 * a value that fits within it can answer `floor` without being examined further.
 */
function getDecimalPrecision(value: number, max: number, floor = 0): number {
	if (!Number.isFinite(value) || value === 0) return 0;

	const abs = Math.abs(value);
	const { decimals, digits } = shortestRepresentation(abs);
	if (decimals <= 0) return 0;

	const capped = Math.min(max, decimals);
	if (digits < NOISE_DIGITS) return capped;

	if (floor > 0 && floor <= capped && equalsAtDecimals(abs, floor)) return floor;
	if (!equalsAtDecimals(abs, capped)) return capped;

	// Fewest decimals at which the value still equals itself (monotone: more decimals only get closer).
	let low = 0;
	let high = capped;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (equalsAtDecimals(abs, middle)) high = middle;
		else low = middle + 1;
	}
	return low;
}

export function getPricePrecision(values: Iterable<ChartDataValue>): number {
	let precision = DEFAULT_PRICE_PRECISION;

	for (const value of values) {
		if (value === null) continue;
		precision = Math.max(precision, getDecimalPrecision(value, MAX_CHART_PRECISION, precision));
		if (precision >= MAX_CHART_PRECISION) return MAX_CHART_PRECISION;
	}

	return precision;
}

export function formatPreciseValue(value: number): string {
	if (!Number.isFinite(value)) return String(value);

	const precision = getDecimalPrecision(value, MAX_DISPLAY_PRECISION);
	if (precision === 0) return Number.isInteger(value) ? value.toString() : value.toFixed(0);

	return value.toFixed(precision).replace(/\.?0+$/, '');
}

/**
 * Decimals for a series whose values carry floating-point noise (indicators computed by the host
 * app), so the scale shows about `significantDigits` digits instead of every decimal of the noise.
 * Based on the largest magnitude; `NaN`, `null` and non-finite values are ignored.
 */
export function getSignificantPrecision(
	values: ArrayLike<number | null | undefined>,
	significantDigits = 5
): number {
	let largest = 0;
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		const magnitude = Math.abs(value);
		if (magnitude > largest) largest = magnitude;
	}
	if (largest === 0) return DEFAULT_PRICE_PRECISION;

	const integerDigits = Math.floor(Math.log10(largest)) + 1;
	return Math.max(
		DEFAULT_PRICE_PRECISION,
		Math.min(MAX_CHART_PRECISION, significantDigits - integerDigits)
	);
}
