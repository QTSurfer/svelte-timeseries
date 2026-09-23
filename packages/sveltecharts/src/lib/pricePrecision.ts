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

function getDecimalPrecision(value: number, max: number): number {
	if (!Number.isFinite(value) || value === 0) return 0;

	const [mantissa, exponentPart] = Math.abs(value).toString().split('e');
	const decimals = (mantissa.split('.')[1] ?? '').length - Number(exponentPart ?? 0);
	return Math.max(0, Math.min(max, decimals));
}

export function getPricePrecision(values: readonly ChartDataValue[]): number {
	let precision = DEFAULT_PRICE_PRECISION;

	for (const value of values) {
		if (value === null) continue;
		precision = Math.max(precision, getDecimalPrecision(value, MAX_CHART_PRECISION));
		if (precision >= MAX_CHART_PRECISION) return MAX_CHART_PRECISION;
	}

	return precision;
}

export function formatPreciseValue(value: number): string {
	if (!Number.isFinite(value)) return String(value);

	const precision = getDecimalPrecision(value, MAX_DISPLAY_PRECISION);
	if (precision === 0) return value.toString();

	return value.toFixed(precision).replace(/\.?0+$/, '');
}
