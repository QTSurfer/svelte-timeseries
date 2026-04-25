export type OHLCColumns = {
	open: string;
	high: string;
	low: string;
	close: string;
};

/**
 * Candlestick resolution string. Examples: '15s', '1m', '5m', '15m', '1h', '4h', '1d'.
 * Format: <number><unit> where unit is s (seconds), m (minutes), h (hours), d (days).
 * When omitted, raw tick data is returned without resampling.
 */
export type OHLCResolution = `${number}${'s' | 'm' | 'h' | 'd'}`;

/**
 * Column name patterns used for OHLC auto-detection (case-insensitive exact match).
 *
 * Single-letter aliases (`o`, `h`, `l`, `c`) are intentionally excluded: they collide too
 * often with unrelated columns in non-financial parquets and would cause false positives.
 * To use single-letter columns, pass an explicit `candlestick: { open, high, low, close }`
 * mapping in the table config.
 */
export const OHLC_CANDIDATES: Record<keyof OHLCColumns, readonly string[]> = {
	open: ['open', '_open', 'opn'],
	high: ['high', '_high', 'hig'],
	low: ['low', '_low'],
	close: ['close', '_close', 'cls']
};

/**
 * Auto-detects OHLC columns by matching against known name patterns.
 * Returns undefined if any of the four roles cannot be matched.
 * The original column casing is preserved in the result.
 */
export function detectOHLCFromColumns(columns: readonly string[]): OHLCColumns | undefined {
	const lowercased = columns.map((c) => c.toLowerCase());
	const resolved: Partial<OHLCColumns> = {};

	for (const [role, candidates] of Object.entries(OHLC_CANDIDATES) as [
		keyof OHLCColumns,
		readonly string[]
	][]) {
		const idx = lowercased.findIndex((col) => candidates.includes(col));
		if (idx === -1) return undefined;
		resolved[role] = columns[idx];
	}

	return resolved as OHLCColumns;
}

/**
 * Converts a resolution string into a DuckDB INTERVAL literal body.
 * Examples: '15s' → '15 seconds', '1m' → '1 minute', '5m' → '5 minutes',
 * '1h' → '1 hour', '1d' → '1 day'.
 *
 * Throws on malformed input.
 */
export function resolutionToInterval(resolution: OHLCResolution): string {
	const match = resolution.match(/^(\d+)(s|m|h|d)$/);
	if (!match) {
		throw new Error(`Invalid resolution format: "${resolution}". Expected e.g. "15s", "5m", "1h".`);
	}
	const n = match[1];
	const unit = match[2];
	const unitMap: Record<string, string> = {
		s: 'second',
		m: 'minute',
		h: 'hour',
		d: 'day'
	};
	const label = unitMap[unit];
	return `${n} ${label}${Number(n) !== 1 ? 's' : ''}`;
}
