import { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { createAsyncDuckDB } from './duckdb-wasm';
import { Schema, Table } from 'apache-arrow';

export type SingleResult = string | number;

export type MarkersTableOptions = {
	table: string;
	targetColumn: string;
	targetDimension: string;
};

type TableData = { url: string; mainColumn: string; columnsSelect?: string[] };
export type Tables = Record<string, TableData>;

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

	private constructor(
		private db: AsyncDuckDB,
		private _tables: T,
		private _markersColumn?: MarkersTableOptions,
		private debug: boolean = false,
		private _tsColumn: string = '_ts'
	) {}

	/** Create a new DuckDB instance */
	static async create<T extends Tables>(
		tables: T,
		markers?: MarkersTableOptions,
		debug: boolean = false
	): Promise<DuckDB<T>> {
		if (!window) throw new Error('DuckDB only works in a browser environment.');
		if (!window.Worker) throw new Error('No worker support?');
		if (debug) console.log('Loading DuckDB...');

		const t0 = performance.now();
		const db = await createAsyncDuckDB();
		const instance = new DuckDB<T>(db, tables, markers, debug);
		await instance.load();
		const t1 = performance.now();
		if (debug) console.log(`DuckDB loaded in ${t1 - t0} ms.`);
		return instance;
	}

	get tsColumnQuery() {
		return `epoch_ms("${this._tsColumn}")::DOUBLE as ${this._tsColumn}`;
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
		return this.getSchema(table)
			.fields.filter((f) => f.name !== this._tsColumn)
			.map((f) => f.name);
	}

	/**
	 * Get data for a table
	 */
	getTable<K extends keyof T>(table: K) {
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
	 *  get data by table
	 */
	async getSingleDimension(table: keyof T, selectColumn: string, omitTimestamp = true) {
		const columnsSelect = [this.tsColumnQuery, this.escapeIdent(selectColumn)];

		const sql = `SELECT ${columnsSelect.join(', ')} FROM ${table.toString()} WHERE ${this.escapeIdent(selectColumn)} NOT NULL`;

		const result = await this.queryBatch(sql);
		const tsKey = this._tsColumn;

		const tsValues: number[] = [];
		const selectValues: any[] = [];

		for await (const table of result) {
			const tsVector = table.getChild(tsKey);
			const colVector = table.getChild(selectColumn);

			if (!tsVector || !colVector) {
				throw new Error(`Column not found: ${!tsVector ? tsKey : selectColumn}`);
			}

			for (let i = 0; i < table.numRows; i++) {
				const valRaw = colVector.get(i);
				selectValues.push(valRaw);

				if (!omitTimestamp) {
					const tsRaw = tsVector.get(i);
					tsValues.push(tsRaw);
				}
			}
		}
		if (omitTimestamp) {
			return {
				[selectColumn]: selectValues
			};
		} else {
			return {
				[this._tsColumn]: tsValues,
				[selectColumn]: selectValues
			};
		}
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
		for (const [name, data] of Object.entries(this._tables) as [keyof T, TableData][]) {
			const { url, ...confg } = data;
			await this.buildTablesAndSchemas(name, data.url, confg);
			continue;
		}
	}

	/**
	 * Build the tables and schemas for the database
	 *
	 * @param name The name of the table
	 * @param url The url of the table
	 * @private
	 */
	private async buildTablesAndSchemas(
		name: keyof T,
		url: string,
		tableConfiguration?: Pick<TableData, 'mainColumn' | 'columnsSelect'>
	) {
		return await this.execute(async (conn) => {
			if (this.debug) console.log('Registering tables and schemas...');

			const viewName = String(name);
			const tempViewName = `__temp_${viewName}`;

			const columnsSelect = tableConfiguration?.columnsSelect?.map((c) => this.escapeIdent(c)) ?? [
				'*'
			];

			if (this._markersColumn?.table === viewName) {
				columnsSelect.push(this._markersColumn.targetColumn);
			}

			const selectColumns = columnsSelect.join(', ');

			// Create temp view from parquet file
			await conn.query(
				`CREATE OR REPLACE VIEW ${this.escapeIdent(tempViewName)} AS SELECT ${selectColumns} FROM parquet_scan('${url}')`
			);

			// detected the initial schema of the temp view
			const initialSchemaData = await conn.query(
				`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = '${tempViewName}'`
			);

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
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.shape') AS VARCHAR), '^"(.*)"$', '\\1') AS shape`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.color') AS VARCHAR), '^"(.*)"$', '\\1') AS color`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.position') AS VARCHAR), '^"(.*)"$', '\\1') AS position`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.text') AS VARCHAR), '^"(.*)"$', '\\1') AS text`
				];
				const selectMarkers = `SELECT ${columnesSelect.join(', ')} FROM ${this.escapeIdent(tempViewName)} WHERE ${this._markersColumn.targetColumn} IS NOT NULL AND json_valid(${this._markersColumn.targetColumn})`;
				await conn.query(`CREATE OR REPLACE VIEW markers AS ${selectMarkers}`);
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

	async getMarkers() {
		if (!this._markersColumn) {
			return [];
		}
		const sql = `SELECT * FROM markers`;

		const result = await this.query(sql);
		return result.toArray();
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
			if (['_ts', 'ts'].includes(f.name)) {
				casts[f.name] = 'TIMESTAMP(ms)';
				return;
			}

			if (f.name.startsWith('_')) {
				return;
			}

			if (f.name === this._markersColumn?.targetColumn) {
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
				const sql = `${this.sqlTimestampFromEpoch(colSQL, unit)} AS ${this._tsColumn}`;
				parts.push(sql);
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

	transformTableToMatrix(table: Table): [number[][], string[]] {
		const columns = table.schema.fields.map((f) => f.name);

		const n = table.numRows;
		const k = columns.length;

		const vectors = new Array(k);
		for (let j = 0; j < k; j++) vectors[j] = table.getChildAt(j);

		const rows = new Array(n);
		for (let i = 0; i < n; i++) {
			const row = new Array(k);
			for (let j = 0; j < k; j++) {
				let value = vectors[j].get(i);
				if (columns[j] === this._tsColumn) {
					if (typeof value === 'bigint') value = Number(value);
					else if (value instanceof Date) value = value.getTime();
				}
				row[j] = value;
			}
			rows[i] = row;
		}

		return [rows, columns];
	}
}
