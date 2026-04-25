import { describe, expect, it } from 'vitest';
import {
	OHLC_CANDIDATES,
	detectOHLCFromColumns,
	resolutionToInterval,
	type OHLCColumns
} from '../../src/lib/duckdb/ohlc';

describe('detectOHLCFromColumns', () => {
	it('matches the canonical names', () => {
		expect(detectOHLCFromColumns(['_ts', 'open', 'high', 'low', 'close'])).toEqual({
			open: 'open',
			high: 'high',
			low: 'low',
			close: 'close'
		});
	});

	it('matches the underscore-prefixed variants', () => {
		expect(detectOHLCFromColumns(['_open', '_high', '_low', '_close'])).toEqual({
			open: '_open',
			high: '_high',
			low: '_low',
			close: '_close'
		});
	});

	it('matches the short aliases (opn/hig/cls)', () => {
		expect(detectOHLCFromColumns(['opn', 'hig', 'low', 'cls'])).toEqual({
			open: 'opn',
			high: 'hig',
			low: 'low',
			close: 'cls'
		});
	});

	it('is case-insensitive but preserves original casing in the result', () => {
		const result = detectOHLCFromColumns(['Open', 'HIGH', 'low', 'Close']);
		expect(result).toEqual({
			open: 'Open',
			high: 'HIGH',
			low: 'low',
			close: 'Close'
		});
	});

	it('does NOT match single-letter aliases (o/h/l/c) — opt-in only', () => {
		expect(detectOHLCFromColumns(['_ts', 'o', 'h', 'l', 'c'])).toBeUndefined();
	});

	it('does NOT match single-letter aliases mixed with full names', () => {
		// Even one missing role drops the whole detection.
		expect(detectOHLCFromColumns(['open', 'h', 'l', 'close'])).toBeUndefined();
	});

	it('returns undefined when any role is missing', () => {
		expect(detectOHLCFromColumns(['open', 'high', 'low'])).toBeUndefined();
		expect(detectOHLCFromColumns(['open', 'high', 'close'])).toBeUndefined();
		expect(detectOHLCFromColumns(['high', 'low', 'close'])).toBeUndefined();
		expect(detectOHLCFromColumns([])).toBeUndefined();
	});

	it('ignores unrelated columns interleaved with OHLC ones', () => {
		const cols = ['symbol', 'open', 'volume', 'high', 'trades', 'low', 'spread', 'close'];
		expect(detectOHLCFromColumns(cols)).toEqual({
			open: 'open',
			high: 'high',
			low: 'low',
			close: 'close'
		});
	});

	it('picks the first matching column when duplicates exist', () => {
		// In practice this should not happen, but the contract is "first match wins".
		const cols = ['open', '_open', 'high', 'low', 'close'];
		const result = detectOHLCFromColumns(cols);
		expect(result?.open).toBe('open');
	});

	it('keeps single-letter columns excluded from the candidates table', () => {
		// Guards against a regression where short aliases get re-introduced.
		const allRoles = Object.values(OHLC_CANDIDATES).flat();
		expect(allRoles).not.toContain('o');
		expect(allRoles).not.toContain('h');
		expect(allRoles).not.toContain('l');
		expect(allRoles).not.toContain('c');
	});

	it('only returns roles defined in OHLCColumns (no extra keys)', () => {
		const result = detectOHLCFromColumns(['open', 'high', 'low', 'close']);
		const expectedKeys: (keyof OHLCColumns)[] = ['open', 'high', 'low', 'close'];
		expect(Object.keys(result!).sort()).toEqual([...expectedKeys].sort());
	});
});

describe('resolutionToInterval', () => {
	it('converts seconds correctly with proper pluralization', () => {
		expect(resolutionToInterval('1s')).toBe('1 second');
		expect(resolutionToInterval('15s')).toBe('15 seconds');
	});

	it('converts minutes correctly with proper pluralization', () => {
		expect(resolutionToInterval('1m')).toBe('1 minute');
		expect(resolutionToInterval('5m')).toBe('5 minutes');
		expect(resolutionToInterval('15m')).toBe('15 minutes');
	});

	it('converts hours correctly with proper pluralization', () => {
		expect(resolutionToInterval('1h')).toBe('1 hour');
		expect(resolutionToInterval('4h')).toBe('4 hours');
	});

	it('converts days correctly with proper pluralization', () => {
		expect(resolutionToInterval('1d')).toBe('1 day');
		expect(resolutionToInterval('7d')).toBe('7 days');
	});

	it('throws on missing unit', () => {
		expect(() => resolutionToInterval('15' as never)).toThrowError(/Invalid resolution/);
	});

	it('throws on unknown unit', () => {
		expect(() => resolutionToInterval('1y' as never)).toThrowError(/Invalid resolution/);
	});

	it('throws on missing number', () => {
		expect(() => resolutionToInterval('m' as never)).toThrowError(/Invalid resolution/);
	});

	it('throws on whitespace or extra characters', () => {
		expect(() => resolutionToInterval(' 5m' as never)).toThrowError(/Invalid resolution/);
		expect(() => resolutionToInterval('5 m' as never)).toThrowError(/Invalid resolution/);
		expect(() => resolutionToInterval('5mm' as never)).toThrowError(/Invalid resolution/);
	});
});
