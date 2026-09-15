import { escapeIdent, timestampToMilliseconds } from './utilities';
import type { DuckDBQueries } from './DuckDBQueries';
import type { MarkersTable, MarkersTableOptions } from './types';
import { TIMESTAMP_COLUMN } from './types';

export class DuckDBMarkers {
	constructor(
		private queries: DuckDBQueries,
		private _markersColumn?: MarkersTableOptions
	) {}

	async getMarkers(): Promise<MarkersTable[]> {
		if (!this._markersColumn) {
			return [];
		}
		const sql = `SELECT * FROM markers ORDER BY ${escapeIdent(TIMESTAMP_COLUMN)}`;

		const result = await this.queries.query(sql);
		return result.toArray().map((row: any) => ({
			...row,
			[TIMESTAMP_COLUMN]: this.normalizeTimestampValue(row[TIMESTAMP_COLUMN])
		}));
	}

	private normalizeTimestampValue(value: unknown): number {
		if (value == null) {
			throw new Error('Unexpected null timestamp in marker data.');
		}
		return timestampToMilliseconds(value);
	}
}
