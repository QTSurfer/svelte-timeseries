import { describe, expect, it, vi } from 'vitest';
import { DuckDBRegistry } from '../../src/lib/duckdb/DuckDBRegistry';
import type { EpochUnit, TableData } from '../../src/lib/duckdb/types';
import { TIMESTAMP_COLUMN, TIMESTAMP_COLUMN_CANDIDATES } from '../../src/lib/duckdb/types';

type RegistryInternals = {
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
	buildCastedSelect(tempViewName: string, casts: Record<string, string>): string;
	buildTimestampSelect(field: { name: string; type: string }, timestampUnit: EpochUnit): string;
};

function createRegistry(): RegistryInternals {
	return new DuckDBRegistry({} as never, {} as never, {} as never) as unknown as RegistryInternals;
}

describe('DuckDBRegistry timestamp units', () => {
	it('infers epoch units from raw numeric timestamp magnitudes', () => {
		const registry = createRegistry();

		expect(registry.inferEpochUnit(1_700_000_000, '_ts')).toBe('s');
		expect(registry.inferEpochUnit(1_700_000_000_000, '_ts')).toBe('ms');
		expect(registry.inferEpochUnit(1_700_000_000_000_000, '_ts')).toBe('us');
		expect(registry.inferEpochUnit(1_700_000_000_000_000_000, '_ts')).toBe('ns');
	});

	it('rejects ambiguous raw numeric timestamp magnitudes', () => {
		const registry = createRegistry();

		expect(() => registry.inferEpochUnit(0, '_ts')).toThrow(
			"Set timestampUnit to 's', 'ms', 'us', or 'ns'."
		);
	});

	it('uses an explicit timestamp unit without sampling the source', async () => {
		const registry = createRegistry();
		const connection = { query: vi.fn() };

		await expect(
			registry.resolveTimestampUnit(
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
		const registry = createRegistry();
		const connection = {
			query: vi.fn().mockResolvedValue({
				toArray: () => [{ timestamp_magnitude: 1_700_000_000_000_000 }]
			})
		};

		await expect(
			registry.resolveTimestampUnit(
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

	it.each(['TIMESTAMP', 'DATE'])('does not infer units for native %s columns', async (type) => {
		const registry = createRegistry();
		const connection = { query: vi.fn() };

		await expect(
			registry.resolveTimestampUnit(
				connection,
				'__temp_ticks',
				{ name: '_ts', type },
				{ url: '/ticks.parquet', mainColumn: 'price' }
			)
		).resolves.toBe('ms');
		expect(connection.query).not.toHaveBeenCalled();
	});

	it.each([0, null])('rejects undetectable numeric timestamps: %s', async (magnitude) => {
		const registry = createRegistry();
		const connection = {
			query: vi.fn().mockResolvedValue({ toArray: () => [{ timestamp_magnitude: magnitude }] })
		};

		await expect(
			registry.resolveTimestampUnit(
				connection,
				'__temp_ticks',
				{ name: '_ts', type: 'BIGINT' },
				{ url: '/ticks.lastra', mainColumn: 'price' }
			)
		).rejects.toThrow("Set timestampUnit to 's', 'ms', 'us', or 'ns'.");
	});

	it('uses the configured unit for data and marker timestamp selects', () => {
		const registry = createRegistry();
		const timestampField = { name: '_ts', type: 'BIGINT' };

		expect(registry.autoDetectFields([timestampField], 'us')).toEqual({
			_ts: 'TIMESTAMP(us)'
		});
		expect(registry.buildTimestampSelect(timestampField, 'us')).toBe(
			'TIMESTAMP \'1970-01-01\' + ("_ts" * INTERVAL 1 MICROSECOND)'
		);
	});
	it.each(TIMESTAMP_COLUMN_CANDIDATES)(
		'normalizes the %s source alias to the shared output column',
		(sourceColumn) => {
			const registry = createRegistry();
			const casts = registry.autoDetectFields([{ name: sourceColumn, type: 'BIGINT' }], 'ms');

			expect(registry.buildCastedSelect('__source', casts)).toBe(
				`SELECT epoch_ms("${sourceColumn}") AS ${TIMESTAMP_COLUMN} FROM "__source"`
			);
		}
	);
});
