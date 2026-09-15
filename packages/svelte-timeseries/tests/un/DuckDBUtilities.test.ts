import { describe, expect, it } from 'vitest';
import { escapeIdent, timestampToMilliseconds } from '../../src/lib/duckdb/utilities';

describe('DuckDB internal utilities', () => {
	it.each([
		['prices', '"prices"'],
		['price"column', '"price""column"'],
		['a""b', '"a""""b"'],
		["trader's price", '"trader\'s price"']
	])('escapes identifier %s', (identifier, expected) => {
		expect(escapeIdent(identifier)).toBe(expected);
	});

	it.each([1000, 1000n, new Date(1000)])('preserves millisecond timestamps: %s', (value) => {
		expect(timestampToMilliseconds(value)).toBe(1000);
	});

	it.each([0, -1000, 1788731525000000n])('does not infer epoch units: %s', (value) => {
		expect(timestampToMilliseconds(value)).toBe(Number(value));
	});
});
