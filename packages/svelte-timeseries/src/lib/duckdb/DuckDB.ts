import type { Table } from '@apache-arrow/ts/table';
import { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { AsyncRecordBatchStreamReader, Schema } from '@apache-arrow/ts';

export type SingleResult = string | number;

export class DuckDB {
	private db: AsyncDuckDB;
	private conn!: AsyncDuckDBConnection;
	private _table!: string;
	private _schema?: Schema;
	private _columns?: string[];
	public debug = false;

	private constructor(db: AsyncDuckDB) {
		this.db = db;
	}

	static async create(): Promise<DuckDB> {
		return new Promise<DuckDB>((resolve, reject) => {
			if (!window) reject('DuckDB only works in a browser environment.');
			else if (window.Worker) {
				try {
					const t0 = performance.now();
					import('./duckdb-wasm')
						.then(({ db }) => {
							const t1 = performance.now();
							console.log(`DuckDB loaded in ${t1 - t0} ms.`);
							resolve(new DuckDB(db));
						})
						.catch((err) => {
							console.log('DuckDB load error!', err);
							reject(err);
						});
				} catch (err) {
					reject(err);
				}
			} else reject('No worker support?');
		});
	}

	set table(name: string) {
		this._table = name;
		this._schema = undefined;
		this._columns = undefined;
	}

	get table(): string {
		return this._table;
	}

	async open(): Promise<void> {
		if (this.conn !== undefined) return;
		const t0 = performance.now();
		this.conn = await this.db.connect();
		const t1 = performance.now();
		if (this.debug) console.log(`DuckDB ${await this.db.getVersion()} connected in ${t1 - t0} ms.`);
	}

	async close(): Promise<void> {
		if (this.conn !== undefined) {
			return await this.conn.close();
		}
	}

	async query(statement: string): Promise<Table> {
		await this.open();
		const t0 = performance.now();
		const result = await this.conn.query(statement);
		const t1 = performance.now();
		if (this.debug) console.log(`DuckDB query (${statement}) executed in ${t1 - t0} ms.`);
		return result;
	}

	async queryBatch(statement: string): Promise<AsyncRecordBatchStreamReader> {
		await this.open();
		const result = this.conn.send(statement);
		return result;
	}

	async getSingle<SingleResult>(query: string): Promise<SingleResult> {
		const result = await this.query(query);
		return result.getChildAt(0)?.get(0);
	}

	async count(): Promise<number> {
		return Number(await this.getSingle(`select count(*) from '${this._table}'`));
	}

	async getSchema(): Promise<Schema> {
		if (this._schema === undefined) {
			this._schema = (await this.query(`select * from '${this._table}' limit 1`)).schema;
		}
		return this._schema;
	}

	async getColumnNames(): Promise<string[]> {
		if (this._columns === undefined) {
			this._columns = (await this.getSchema()).fields.map((f) => f.name);
		}
		return this._columns;
	}
}
