import { escapeIdent } from './utilities';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { DuckDBConnection } from './DuckDBConnection';

export class DuckDBQueries {
	private _versionDb?: string;

	constructor(
		private connection: DuckDBConnection,
		private debug: boolean = false
	) {}

	async query(sql: string) {
		return await this.execute((conn) => conn.query(sql), 'query');
	}

	async queryBatch(statement: string) {
		return this.execute((conn) => conn.send(statement), 'queryBatch');
	}

	async getSingle<R>(query: string): Promise<R> {
		const result = await this.query(query);
		return result.getChildAt(0)?.get(0);
	}

	async count(table: string): Promise<number> {
		return Number(await this.getSingle(`select count(*) from ${escapeIdent(table)}`));
	}

	async execute<R>(
		fn: (connection: AsyncDuckDBConnection, db: AsyncDuckDB) => Promise<R>,
		label: string = 'query'
	): Promise<R> {
		const t0 = performance.now();
		const conn = this.connection.connection;
		const db = this.connection.database;

		try {
			const result = await fn(conn, db);
			return result;
		} finally {
			const t1 = performance.now();
			if (this.debug) {
				const version = await this.getVersion();
				console.log(`DuckDB ${version} ${label} in ${(t1 - t0).toFixed(1)} ms.`);
			}
		}
	}

	private async getVersion(): Promise<string> {
		if (!this._versionDb) {
			this._versionDb = await this.connection.database.getVersion();
		}
		return this._versionDb;
	}
}
