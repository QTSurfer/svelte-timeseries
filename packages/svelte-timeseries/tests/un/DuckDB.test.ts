import { describe, expect, it, vi } from 'vitest';
import { DuckDB, type EpochUnit, type TableData } from '../../src/lib/duckdb/DuckDB';

type DuckDBInternals = {
	resolveTimestampUnit(
		connection: { query: ReturnType<typeof vi.fn> },
		tempViewName: string,
		field: { name: string; type: string },
		tableConfiguration: TableData
	): Promise<EpochUnit>;
	inferEpochUnit(magnitude: number, fieldName: string): EpochUnit;
	autoDetectFields(
		fields: Array<{ name: string; type: string }>,
		timestampUnit: EpochUnit
	): Record<string, string>;
	buildTimestampSelect(field: { name: string; type: string }, timestampUnit: EpochUnit): string;
};

function createDuckDB(): DuckDBInternals {
	return new (DuckDB as unknown as new () => DuckDBInternals)();
}

describe('DuckDB timestamp units', () => {
	it('infers epoch units from raw numeric timestamp magnitudes', () => {
		const duckDB = createDuckDB();

		expect(duckDB.inferEpochUnit(1_700_000_000, '_ts')).toBe('s');
		expect(duckDB.inferEpochUnit(1_700_000_000_000, '_ts')).toBe('ms');
		expect(duckDB.inferEpochUnit(1_700_000_000_000_000, '_ts')).toBe('us');
		expect(duckDB.inferEpochUnit(1_700_000_000_000_000_000, '_ts')).toBe('ns');
	});

	it('rejects ambiguous raw numeric timestamp magnitudes', () => {
		const duckDB = createDuckDB();

		expect(() => duckDB.inferEpochUnit(0, '_ts')).toThrow(
			"Set timestampUnit to 's', 'ms', 'us', or 'ns'."
		);
	});

	it('uses an explicit timestamp unit without sampling the source', async () => {
		const duckDB = createDuckDB();
		const connection = { query: vi.fn() };

		await expect(
			duckDB.resolveTimestampUnit(
				connection,
				'__temp_ticks',
				{ name: '_ts', type: 'BIGINT' },
				{
					url: '/ticks.parquet',
					mainColumn: 'price',
					timestampUnit: 'us'
				}
			)
		).resolves.toBe('us');
		expect(connection.query).not.toHaveBeenCalled();
	});

	it('samples numeric timestamps when no unit is configured', async () => {
		const duckDB = createDuckDB();
		const connection = {
			query: vi.fn().mockResolvedValue({
				toArray: () => [{ timestamp_magnitude: 1_700_000_000_000_000 }]
			})
		};

		await expect(
			duckDB.resolveTimestampUnit(
				connection,
				'__temp_ticks',
				{ name: '_ts', type: 'BIGINT' },
				{
					url: '/ticks.parquet',
					mainColumn: 'price'
				}
			)
		).resolves.toBe('us');
		expect(connection.query).toHaveBeenCalledWith(
			expect.stringContaining('MAX(ABS(CAST("_ts" AS DOUBLE)))')
		);
	});

	it('uses the configured unit for data and marker timestamp selects', () => {
		const duckDB = createDuckDB();
		const timestampField = { name: '_ts', type: 'BIGINT' };

		expect(duckDB.autoDetectFields([timestampField], 'us')).toEqual({
			_ts: 'TIMESTAMP(us)'
		});
		expect(duckDB.buildTimestampSelect(timestampField, 'us')).toBe(
			'TIMESTAMP \'1970-01-01\' + ("_ts" * INTERVAL 1 MICROSECOND)'
		);
	});
});
