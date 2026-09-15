import { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { createAsyncDuckDB } from './duckdb-wasm';

export class DuckDBConnection {
	private db: AsyncDuckDB | null = null;
	private conn: AsyncDuckDBConnection | null = null;

	private constructor(db: AsyncDuckDB, conn: AsyncDuckDBConnection) {
		this.db = db;
		this.conn = conn;
	}

	static async create(debug = false): Promise<DuckDBConnection> {
		const t0 = performance.now();
		const db = await createAsyncDuckDB();
		const conn = await db.connect();
		const instance = new DuckDBConnection(db, conn);
		const t1 = performance.now();
		if (debug) console.log(`DuckDB loaded in ${(t1 - t0).toFixed(1)} ms.`);
		return instance;
	}

	async close(): Promise<void> {
		await this.conn?.close();
		await this.db?.terminate();
	}

	get connection(): AsyncDuckDBConnection {
		if (!this.conn) throw new Error('Connection not initialized');
		return this.conn;
	}

	get database(): AsyncDuckDB {
		if (!this.db) throw new Error('Database not initialized');
		return this.db;
	}
}
