import type { ChartDataValue } from './chartAdapter';

const DEFAULT_PRICE_PRECISION = 2;
const MAX_PRICE_PRECISION = 30;

function getDecimalPrecision(value: number): number {
	if (!Number.isFinite(value) || value === 0) return 0;

	const [mantissa, exponentPart] = Math.abs(value).toString().split('e');
	const decimals = (mantissa.split('.')[1] ?? '').length - Number(exponentPart ?? 0);
	return Math.max(0, Math.min(MAX_PRICE_PRECISION, decimals));
}

export function getPricePrecision(values: readonly ChartDataValue[]): number {
	let precision = DEFAULT_PRICE_PRECISION;

	for (const value of values) {
		if (value === null) continue;
		precision = Math.max(precision, getDecimalPrecision(value));
		if (precision >= MAX_PRICE_PRECISION) return MAX_PRICE_PRECISION;
	}

	return precision;
}

export function formatPreciseValue(value: number): string {
	if (!Number.isFinite(value)) return String(value);

	const precision = getDecimalPrecision(value);
	if (precision === 0) return value.toString();

	return value.toFixed(precision).replace(/\.?0+$/, '');
}
