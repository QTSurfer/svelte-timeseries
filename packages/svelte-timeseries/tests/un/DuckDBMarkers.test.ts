import { describe, expect, it, vi } from 'vitest';
import { DuckDBMarkers } from '../../src/lib/duckdb/DuckDBMarkers';
import { TIMESTAMP_COLUMN } from '../../src/lib/duckdb/types';

describe('DuckDBMarkers timestamp contract', () => {
	it.each([
		['number', 1000, 1000],
		['bigint', 1000n, 1000],
		['Date', new Date(1000), 1000]
	])('normalizes %s timestamps and preserves marker fields', async (_type, timestamp, expected) => {
		const queries = {
			query: vi.fn(async () => ({
				toArray: () => [
					{
						[TIMESTAMP_COLUMN]: timestamp,
						shape: 'circle',
						color: 'green',
						position: 'aboveBar',
						text: 'Entry'
					}
				]
			}))
		};
		const markers = new DuckDBMarkers(queries as never, {
			table: 'prices',
			targetColumn: '_markers',
			targetDimension: 'price'
		});

		await expect(markers.getMarkers()).resolves.toEqual([
			{
				[TIMESTAMP_COLUMN]: expected,
				shape: 'circle',
				color: 'green',
				position: 'aboveBar',
				text: 'Entry'
			}
		]);
		expect(queries.query).toHaveBeenCalledWith(
			`SELECT * FROM markers ORDER BY "${TIMESTAMP_COLUMN}"`
		);
	});

	it.each([null, undefined])('rejects a missing marker timestamp: %s', async (timestamp) => {
		const queries = {
			query: vi.fn(async () => ({ toArray: () => [{ [TIMESTAMP_COLUMN]: timestamp }] }))
		};
		const markers = new DuckDBMarkers(queries as never, {
			table: 'prices',
			targetColumn: '_markers',
			targetDimension: 'price'
		});

		await expect(markers.getMarkers()).rejects.toThrow('Unexpected null timestamp in marker data.');
	});

	it('returns no markers without querying when marker configuration is absent', async () => {
		const queries = { query: vi.fn() };
		const markers = new DuckDBMarkers(queries as never);

		await expect(markers.getMarkers()).resolves.toEqual([]);
		expect(queries.query).not.toHaveBeenCalled();
	});
});
