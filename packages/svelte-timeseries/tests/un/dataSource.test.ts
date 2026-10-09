import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectDataSource } from '../../src/lib/dataSource';
import type { Tables } from '../../src/lib/duckdb/types';

describe('selectDataSource (the decision to start DuckDB)', () => {
	const table: Tables = { temps: { url: '/temps.parquet', mainColumn: 'temp' } };

	it('uses DuckDB for a non-empty table', () => {
		expect(selectDataSource(table, false)).toEqual({ source: 'duckdb', warning: undefined });
	});

	it('does not start DuckDB without a table', () => {
		expect(selectDataSource(undefined, true).source).toBe('arrays');
		expect(selectDataSource(null, true).source).toBe('arrays');
	});

	it('does not start DuckDB for an empty table object either', () => {
		expect(selectDataSource({}, true).source).toBe('arrays');
	});

	it('feeds a chart that has neither table nor arrays from the arrays path (just injected series)', () => {
		expect(selectDataSource(undefined, false)).toEqual({ source: 'arrays' });
	});

	it('prefers the table and warns when arrays were given as well', () => {
		const result = selectDataSource(table, true);
		expect(result.source).toBe('duckdb');
		expect(result.warning).toContain('arrays are ignored');
	});
});

describe('SvelteTimeSeries keeps DuckDB out of the arrays path', () => {
	const source = readFileSync(
		new URL('../../src/lib/component/SvelteTimeSeries.svelte', import.meta.url),
		'utf8'
	);

	it('imports DuckDB only on demand, inside the table-driven load', () => {
		expect(source).toMatch(/await import\('\.\.\/duckdb\/DuckDB'\)/);
		expect(source).not.toMatch(/import\s*\{[^}]*\bDuckDB\b[^}]*\}\s*from\s*'\.\.\/duckdb\/DuckDB'/);
	});

	it('only creates the connection after a table was selected', () => {
		const create = source.indexOf('DuckDB.create(');
		expect(create).toBeGreaterThan(source.indexOf('await import('));
		expect(source.slice(0, create)).toContain('if (!table || !entry) return;');
	});
});
