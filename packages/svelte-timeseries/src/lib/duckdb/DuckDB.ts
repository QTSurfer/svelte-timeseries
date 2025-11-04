import { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { Schema } from 'apache-arrow';
import { createAsyncDuckDB } from './duckdb-wasm';
import { get } from 'svelte/store';

export type SingleResult = string | number;

type MarkersTableOptions = {
	table: string;
	objetiveColumn: string;
};
type TablesType = string | MarkersTableOptions;

type Tables = Record<string, TablesType>;

type ColumsSchema = { name: string; type: string }[];

type EpochUnit = 's' | 'ms' | 'us' | 'ns';

type DuckDBType =
	| 'BOOLEAN'
	| 'TINYINT'
	| 'SMALLINT'
	| 'INTEGER'
	| 'BIGINT'
	| 'HUGEINT'
	| 'REAL'
	| 'DOUBLE'
	| 'DECIMAL'
	| 'VARCHAR'
	| 'DATE'
	| 'TIMESTAMP'
	| 'BLOB'
	| 'JSON';

// Allows you to specify TIMESTAMP with unit: 'TIMESTAMP(ms)' etc.
type TargetType = DuckDBType | `TIMESTAMP(${EpochUnit})`;

export class DuckDB<T extends Tables> {
	private _conn?: AsyncDuckDBConnection;
	private _schemas: Partial<Record<keyof T, Schema>> = {};
	private _versionDb?: string;
	private _markersColumn?: MarkersTableOptions & { name: string };

	private constructor(
		private db: AsyncDuckDB,
		private _tables: T,
		public debug: boolean = false,
		private _tsColumn: string = '_ts'
	) {}

	/** Create a new DuckDB instance */
	static async create<T extends Tables>(tables: T, debug: boolean = false): Promise<DuckDB<T>> {
		if (!window) throw new Error('DuckDB only works in a browser environment.');
		if (!window.Worker) throw new Error('No worker support?');
		if (debug) console.log('Loading DuckDB...');

		const t0 = performance.now();
		const db = await createAsyncDuckDB();
		const instance = new DuckDB<T>(db, tables, debug);
		await instance.load();
		const t1 = performance.now();
		if (debug) console.log(`DuckDB loaded in ${t1 - t0} ms.`);
		return instance;
	}

	/**
	 * Get the schema for a table
	 */
	getSchema(table: keyof T) {
		if (!this._schemas[table]) throw new Error(`Schema for ${String(table)} not initialized`);
		return this._schemas[table];
	}

	/**
	 * Get the column names for a table
	 */
	getColumns(table: keyof T): string[] {
		return this.getSchema(table).fields.map((f) => f.name);
	}

	/**
	 * Get data for a table
	 */
	getTable(table: keyof T): TablesType {
		return this._tables[table];
	}

	/**
	 * Close the connection to the database
	 */
	async closeConnection(): Promise<void> {
		if (this._conn) {
			await this._conn.close();
		}
	}

	/**
	 *  Execute a query
	 */
	async query(sql: string) {
		return await this.execute((conn) => conn.query(sql), 'query');
	}

	/**
	 * Execute a batch of queries
	 */
	async queryBatch(statement: string) {
		return this.execute((conn) => conn.send(statement), 'queryBatch');
	}

	/**
	 * Get a range of data
	 * @param table The table to get the data from
	 * @param start The start of the range (inclusive) as a timestamp
	 * @param end The end of the range as a timestamp
	 */
	async getRangeData(table: keyof T, start: number | string, end: number | string, limit?: number) {
		const view = this.escapeIdent(String(table));

		const startExp = typeof start === 'string' ? `'${start}'` : `${start}`;
		const endtExp = typeof end === 'string' ? `'${end}'` : `${end}`;
		const limitClause = limit ? `LIMIT ${limit}` : '';

		const sql = `
			SELECT *
			FROM ${view}
			WHERE ${this._tsColumn} >= ${startExp} AND ${this._tsColumn} < ${endtExp}
			ORDER BY "${this._tsColumn}"
			${limitClause};
		`;

		return await this.queryBatch(sql);
	}

	/**
	 * Get a single value
	 */
	async getSingle<SingleResult>(query: string): Promise<SingleResult> {
		const result = await this.query(query);
		return result.getChildAt(0)?.get(0);
	}

	/**
	 * Count the number of rows in a table
	 */
	async count(table: keyof typeof this._tables): Promise<number> {
		return Number(await this.getSingle(`select count(*) from '${this._tables[table]}'`));
	}

	/**
	 * Get the type of a column
	 */
	getColumnTypeName(table: keyof typeof this._tables, column: string): string {
		return (
			this.getSchema(table)
				.fields.find((f) => f.name === column)
				?.type.toString() ?? ''
		);
	}

	/**
	 * Escape an identifier
	 */
	private escapeIdent(ident: string): string {
		// escape simple para identificadores
		return `"${ident.replace(/"/g, '""')}"`;
	}

	/**
	 * Register the tables and schemas in the database
	 */
	private async registerData() {
		for (const [name, type] of Object.entries(this._tables) as [keyof T, TablesType][]) {
			if (typeof type === 'object') {
				this._markersColumn = {
					...type,
					name: String(name)
				};
				continue;
			}

			if (typeof type === 'string') {
				const url = type;
				await this.buildTablesAndSchemas(name.toString(), url);
				continue;
			}
		}
	}

	/**
	 * Build the tables and schemas for the database
	 *
	 * @param name The name of the table
	 * @param url The url of the table
	 * @private
	 */
	private async buildTablesAndSchemas(name: keyof T, url: string) {
		return await this.execute(async (conn) => {
			if (this.debug) console.log('Registering tables and schemas...');

			const viewName = String(name);
			const tempViewName = `__temp_${viewName}`;

			// Create temp view from parquet file
			await conn.query(
				`CREATE OR REPLACE VIEW ${this.escapeIdent(tempViewName)} AS SELECT * FROM parquet_scan('${url}')`
			);

			// detected the initial schema of the temp view
			const initialSchemaData = await conn.query(`
						SELECT column_name AS name, data_type AS type
						FROM information_schema.columns
						WHERE table_name = '${tempViewName}'
						`);

			const initialSchema: ColumsSchema = initialSchemaData.toArray();

			// use the initial schema to build the casted select
			const targetCasts = this.autoDetectFields(initialSchema);

			// Build the casted select
			const castedSelect = this.buildCastedSelect(tempViewName, targetCasts);

			// Create final view
			await conn.query(`CREATE OR REPLACE VIEW ${this.escapeIdent(viewName)} AS ${castedSelect}`);

			// Create markers view if needed
			if (this._markersColumn?.table === viewName) {
				const columnesSelect = [
					`${this.sqlTimestampFromEpoch(this._tsColumn, 'ms')} AS ${this._tsColumn}`,
					`CAST(${this._markersColumn.objetiveColumn} AS JSON) AS ${this._markersColumn.objetiveColumn}`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.objetiveColumn}, '$.shape') AS VARCHAR), '^"(.*)"$', '\\1') AS shape`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.objetiveColumn}, '$.color') AS VARCHAR), '^"(.*)"$', '\\1') AS color`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.objetiveColumn}, '$.position') AS VARCHAR), '^"(.*)"$', '\\1') AS position`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.objetiveColumn}, '$.text') AS VARCHAR), '^"(.*)"$', '\\1') AS text`
				];
				const selectMarkers = `SELECT ${columnesSelect.join(', ')} FROM ${this.escapeIdent(tempViewName)} WHERE ${this._markersColumn.objetiveColumn} IS NOT NULL AND json_valid(${this._markersColumn.objetiveColumn})`;
				await conn.query(`CREATE OR REPLACE VIEW ${this._markersColumn.name} AS ${selectMarkers}`);
			}

			// Get the final schema
			const { schema: finalSchema } = await conn.query(
				`SELECT * FROM ${this.escapeIdent(viewName)} LIMIT 0`
			);

			if (this.debug) {
				console.log(`Registered table ${viewName}`);
			}

			this._schemas[name] = finalSchema;

			// Store the final schema
			return finalSchema;
		}, 'buildTablesAndSchemas - ' + name.toString());
	}

	/**
	 * Load the database
	 */
	private async load() {
		await this.registerData();
	}

	/**
	 * Get the version of the database
	 */
	private async getVersion(): Promise<string> {
		if (!this._versionDb) {
			this._versionDb = await this.db.getVersion();
		}
		return this._versionDb;
	}

	/**
	 * Get the tables
	 */
	get tables() {
		return this._tables;
	}

	async getMarkets() {
		if (!this._markersColumn) {
			throw new Error('Markers not found');
		}
		const sql = `SELECT * FROM ${this._markersColumn.name}`;

		const result = await this.query(sql);
		return result;
	}

	/**
	 * Execute a function on the DuckDB connection.
	 */
	private async execute<R>(
		fn: (connection: AsyncDuckDBConnection, db: AsyncDuckDB) => Promise<R>,
		label: string = 'query'
	): Promise<R> {
		const t0 = performance.now();

		if (!this._conn) {
			this._conn = await this.db.connect();
		}

		try {
			const result = await fn(this._conn, this.db);
			return result;
		} finally {
			const t1 = performance.now();
			if (this.debug) {
				const version = await this.getVersion();
				console.log(`DuckDB ${version} ${label} in ${(t1 - t0).toFixed(1)} ms.`);
			}
		}
	}

	/**
	 * Convert a column from epoch to timestamp
	 */
	private sqlTimestampFromEpoch(colSQL: string, unit: EpochUnit): string {
		if (unit === 'ms') return `epoch_ms(${colSQL})`;
		if (unit === 's') return `TIMESTAMP '1970-01-01' + (${colSQL} * INTERVAL 1 SECOND)`;
		if (unit === 'us') return `TIMESTAMP '1970-01-01' + (${colSQL} * INTERVAL 1 MICROSECOND)`;
		// ns → μs
		return `TIMESTAMP '1970-01-01' + ((${colSQL} / 1000) * INTERVAL 1 MICROSECOND)`;
	}

	/**
	 * Automatically detect the type of each column
	 */
	private autoDetectFields(fields: ColumsSchema): Record<string, TargetType> {
		const casts: Record<string, TargetType> = {};

		fields.forEach((f, idx) => {
			if (f.name === this._tsColumn) {
				// The first column is the timestamp
				casts[f.name] = 'TIMESTAMP(ms)';
				return;
			}

			if (f.name.startsWith('_')) {
				return;
			}

			if (f.name === this._markersColumn?.objetiveColumn) {
				return;
			}

			if (f.name.endsWith('%')) {
				casts[f.name] = 'DOUBLE';
				return;
			}

			//
			casts[f.name] = (f.type?.toString()?.toUpperCase() as DuckDBType) ?? 'VARCHAR';
		});

		return casts;
	}

	/**
	 * Build the casted type
	 */
	private buildCastedSelect(tempViewName: string, casts: Record<string, TargetType>): string {
		// Build the casted select
		const parts: string[] = [];

		for (const [col, target] of Object.entries(casts)) {
			const colSQL = this.escapeIdent(col);

			// Timestamp with unit
			const m = typeof target === 'string' ? target.match(/^TIMESTAMP\((s|ms|us|ns)\)$/i) : null;
			if (m) {
				const unit = m[1].toLowerCase() as EpochUnit;
				parts.push(`${this.sqlTimestampFromEpoch(colSQL, unit)} AS ${colSQL}`);
				continue;
			}

			// TIMESTAMP Without unit
			if (target === 'TIMESTAMP') {
				parts.push(`${colSQL} AS ${colSQL}`);
				continue;
			}

			// Other types
			parts.push(`CAST(${colSQL} AS ${target}) AS ${colSQL}`);
		}

		// Build the select
		return `SELECT ${parts.join(', ')} FROM ${this.escapeIdent(tempViewName)}`;
	}
}
