import type { Tables } from './duckdb/types';

export type DataSource = 'duckdb' | 'arrays';

/**
 * Decides where the chart data comes from, which is also the decision whether DuckDB is needed:
 * only a non-empty `table` starts it. Without one the chart is fed from arrays (or just injected
 * series) and DuckDB is neither imported nor started.
 */
export function selectDataSource(
	table: Tables | null | undefined,
	hasArrays: boolean
): { source: DataSource; warning?: string } {
	if (table && Object.keys(table).length > 0) {
		return {
			source: 'duckdb',
			warning: hasArrays
				? 'Both "table" and "price" / "candles" were given; the table is used and the arrays are ignored.'
				: undefined
		};
	}
	return { source: 'arrays' };
}
