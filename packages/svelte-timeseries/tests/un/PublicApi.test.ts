import { describe, expect, it } from 'vitest';
import { DuckDB } from '../../src/lib';
import * as publicApi from '../../src/lib';

describe('package public API', () => {
	it('keeps DuckDB implementation classes internal', () => {
		expect(Object.keys(publicApi).sort()).toEqual([
			'DuckDB',
			'SvelteTimeSeries',
			'TimeSeriesFacade'
		]);
	});

	it('preserves the normalized timestamp query accessor', () => {
		const duckDb = Object.create(DuckDB.prototype) as DuckDB<Record<string, never>>;

		expect(duckDb.tsColumnQuery).toBe('"_ts"');
	});
});
