import { AsyncDuckDB, AsyncDuckDBConnection, DuckDBDataProtocol } from '@duckdb/duckdb-wasm';
import { createAsyncDuckDB } from './duckdb-wasm';
import { Schema, Table } from 'apache-arrow';

export type SingleResult = string | number;

export type MarkersTableOptions = {
	table: string;
	targetColumn: string;
	targetDimension: string;
};

export type ParquetSource = Blob | ArrayBuffer | Uint8Array;

export type OHLCColumns = {
	open: string;
	high: string;
	low: string;
	close: string;
};

/**
 * Candlestick resolution string. Examples: '15s', '1m', '5m', '15m', '1h', '4h', '1d'.
 * Format: <number><unit> where unit is s (seconds), m (minutes), h (hours), d (days).
 * When omitted, raw tick data is returned without resampling.
 */
export type OHLCResolution = `${number}${'s' | 'm' | 'h' | 'd'}`;

/** Column name patterns used for OHLC auto-detection (case-insensitive exact match). */
const OHLC_CANDIDATES: Record<keyof OHLCColumns, string[]> = {
	open: ['open', '_open', 'opn', 'o'],
	high: ['high', '_high', 'hig', 'h'],
	low: ['low', '_low', 'l'],
	close: ['close', '_close', 'cls', 'c']
};

type TableDataBase = {
	mainColumn: string;
	columnsSelect?: string[];
	/**
	 * Explicit OHLC column mapping, or `false` to disable auto-detection entirely.
	 * If omitted, auto-detection is attempted by column name.
	 */
	candlestick?: OHLCColumns | false;
	/**
	 * Candlestick resampling resolution. When set, DuckDB aggregates ticks into OHLC bars
	 * of the given size using time_bucket. Examples: '15s', '1m', '5m', '1h'.
	 */
	resolution?: OHLCResolution;
};

type TableDataFromUrl = TableDataBase & {
	url: string;
	parquet?: never;
};

type TableDataFromParquet = TableDataBase & {
	url?: never;
	parquet: ParquetSource;
};

export type TableData = TableDataFromUrl | TableDataFromParquet;
export type Tables = Record<string, TableData>;

type IconType =
	| 'circle'
	| 'rect'
	| 'roundRect'
	| 'triangle'
	| 'diamond'
	| 'pin'
	| 'arrowUp'
	| 'arrowDown'
	| 'none';

export type MarkersTable = {
	_ts: number;
	shape: IconType;
	color: string;
	position: string;
	text: string;
};
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
const TIMESTAMP_COLUMN_CANDIDATES = ['_ts', 'ts', '_t', 't'] as const;

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
		return this.escapeIdent(this._tsColumn);
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
	 * Returns the resolved OHLC column mapping for a table, or undefined if not applicable.
	 * Uses the explicit `candlestick` config first; falls back to auto-detection by column name.
	 */
	resolveOHLC(table: keyof T): OHLCColumns | undefined {
		const config = this._tables[table];
		if (config.candlestick === false) return undefined;
		if (config.candlestick) return config.candlestick;
		return this.detectOHLC(table);
	}

	/**
	 * Fetches the four OHLC columns plus the timestamp as a columnar object.
	 * Returns `{ _ts: number[], open: number[], high: number[], low: number[], close: number[] }`
	 * using the resolved column names as keys.
	 *
	 * When `resolution` is provided, DuckDB resamples the ticks into fixed-size bars using
	 * time_bucket(). open = FIRST value, close = LAST value, high = MAX, low = MIN.
	 */
	async getOHLC(
		table: keyof T,
		ohlc: OHLCColumns,
		resolution?: OHLCResolution
	): Promise<Record<string, number[]>> {
		const sql = resolution
			? this.buildOHLCResampledSQL(String(table), ohlc, resolution)
			: this.buildOHLCRawSQL(String(table), ohlc);

		const result = await this.queryBatch(sql);

		const tsValues: number[] = [];
		const openValues: number[] = [];
		const highValues: number[] = [];
		const lowValues: number[] = [];
		const closeValues: number[] = [];

		for await (const batch of result) {
			const tsVec = batch.getChild(this._tsColumn);
			const openVec = batch.getChild(ohlc.open);
			const highVec = batch.getChild(ohlc.high);
			const lowVec = batch.getChild(ohlc.low);
			const closeVec = batch.getChild(ohlc.close);

			if (!tsVec || !openVec || !highVec || !lowVec || !closeVec) {
				throw new Error('One or more OHLC columns not found in result.');
			}

			for (let i = 0; i < batch.numRows; i++) {
				tsValues.push(this.normalizeTimestampValue(tsVec.get(i)));
				openValues.push(Number(openVec.get(i)));
				highValues.push(Number(highVec.get(i)));
				lowValues.push(Number(lowVec.get(i)));
				closeValues.push(Number(closeVec.get(i)));
			}
		}

		return {
			[this._tsColumn]: tsValues,
			[ohlc.open]: openValues,
			[ohlc.high]: highValues,
			[ohlc.low]: lowValues,
			[ohlc.close]: closeValues
		};
	}

	private buildOHLCRawSQL(table: string, ohlc: OHLCColumns): string {
		const cols = [
			this.tsColumnQuery,
			this.escapeIdent(ohlc.open),
			this.escapeIdent(ohlc.high),
			this.escapeIdent(ohlc.low),
			this.escapeIdent(ohlc.close)
		];
		return `SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${this.tsColumnQuery}`;
	}

	private buildOHLCResampledSQL(table: string, ohlc: OHLCColumns, resolution: OHLCResolution): string {
		const interval = this.resolutionToInterval(resolution);
		const ts = this.tsColumnQuery;
		const o = this.escapeIdent(ohlc.open);
		const h = this.escapeIdent(ohlc.high);
		const l = this.escapeIdent(ohlc.low);
		const c = this.escapeIdent(ohlc.close);

		// time_bucket returns a TIMESTAMP; we alias it to _ts so the result column matches
		return `
			SELECT
				time_bucket(INTERVAL '${interval}', ${ts}) AS ${this._tsColumn},
				FIRST(${o} ORDER BY ${ts}) AS ${ohlc.open},
				MAX(${h})                  AS ${ohlc.high},
				MIN(${l})                  AS ${ohlc.low},
				LAST(${c} ORDER BY ${ts})  AS ${ohlc.close}
			FROM ${table}
			GROUP BY 1
			ORDER BY 1
		`;
	}

	/** Converts '15s' → '15 seconds', '5m' → '5 minutes', '1h' → '1 hour', '1d' → '1 day'. */
	private resolutionToInterval(resolution: OHLCResolution): string {
		const match = resolution.match(/^(\d+)(s|m|h|d)$/);
		if (!match) throw new Error(`Invalid resolution format: "${resolution}". Expected e.g. "15s", "5m", "1h".`);
		const n = match[1];
		const unit = match[2];
		const unitMap: Record<string, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
		const label = unitMap[unit];
		return `${n} ${label}${Number(n) !== 1 ? 's' : ''}`;
	}

	/**
	 * Auto-detects OHLC columns by matching against known name patterns.
	 * Returns undefined if any of the four roles cannot be matched.
	 */
	private detectOHLC(table: keyof T): OHLCColumns | undefined {
		const columns = this.getColumns(table).map((c) => c.toLowerCase());
		const resolved: Partial<OHLCColumns> = {};

		for (const [role, candidates] of Object.entries(OHLC_CANDIDATES) as [
			keyof OHLCColumns,
			string[]
		][]) {
			const match = columns.find((col) => candidates.includes(col));
			if (!match) return undefined;
			// Return original casing from schema
			resolved[role] = this.getColumns(table).find((c) => c.toLowerCase() === match)!;
		}

		return resolved as OHLCColumns;
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

		const sql = `SELECT ${columnsSelect.join(', ')} FROM ${table.toString()} WHERE ${this.escapeIdent(selectColumn)} NOT NULL ORDER BY ${this.tsColumnQuery}`;

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
					tsValues.push(this.normalizeTimestampValue(tsRaw));
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
			await this.buildTablesAndSchemas(name, data);
		}
	}

	/**
	 * Build the tables and schemas for the database
	 *
	 * @param name The name of the table
	 * @param url The url of the table
	 * @private
	 */
	private async buildTablesAndSchemas(name: keyof T, tableConfiguration: TableData) {
		return await this.execute(async (conn) => {
			if (this.debug) console.log('Registering tables and schemas...');

			const viewName = String(name);
			const tempViewName = `__temp_${viewName}`;
			const sourcePath = await this.registerParquetSource(viewName, tableConfiguration);

			const columnsSelect = tableConfiguration?.columnsSelect?.map((c) => this.escapeIdent(c)) ?? [
				'*'
			];

			if (this._markersColumn?.table === viewName) {
				columnsSelect.push(this._markersColumn.targetColumn);
			}

			const selectColumns = columnsSelect.join(', ');

			// Create temp view from parquet file
			await conn.query(
				`CREATE OR REPLACE VIEW ${this.escapeIdent(tempViewName)} AS SELECT ${selectColumns} FROM parquet_scan('${sourcePath}')`
			);

			// detected the initial schema of the temp view
			const initialSchemaData = await conn.query(
				`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = '${tempViewName}'`
			);

			const initialSchema: ColumsSchema = initialSchemaData.toArray();
			const sourceTimestampField = this.getTimestampSourceField(initialSchema);

			if (!sourceTimestampField) {
				throw new Error(
					`Time column not found in "${viewName}". Expected one of: ${TIMESTAMP_COLUMN_CANDIDATES.join(', ')}`
				);
			}

			// use the initial schema to build the casted select
			const targetCasts = this.autoDetectFields(initialSchema);

			// Build the casted select
			const castedSelect = this.buildCastedSelect(tempViewName, targetCasts);

			// Create final view
			await conn.query(`CREATE OR REPLACE VIEW ${this.escapeIdent(viewName)} AS ${castedSelect}`);

			// Create markers view if needed
			if (this._markersColumn?.table === viewName) {
				const columnesSelect = [
					`${this.buildTimestampSelect(sourceTimestampField)} AS ${this._tsColumn}`,
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

	private async registerParquetSource(
		viewName: string,
		tableConfiguration: TableData
	): Promise<string> {
		if (tableConfiguration.url !== undefined) {
			return tableConfiguration.url;
		}

		const registeredFileName = `${viewName}.parquet`;
		const parquet = tableConfiguration.parquet;

		if (parquet instanceof Uint8Array) {
			await this.db.registerFileBuffer(registeredFileName, parquet);
			return registeredFileName;
		}

		if (parquet instanceof ArrayBuffer) {
			await this.db.registerFileBuffer(registeredFileName, new Uint8Array(parquet));
			return registeredFileName;
		}

		if (parquet instanceof Blob) {
			if (typeof File !== 'undefined' && parquet instanceof File) {
				await this.db.registerFileHandle(
					registeredFileName,
					parquet,
					DuckDBDataProtocol.BROWSER_FILEREADER,
					true
				);
				return registeredFileName;
			}

			const buffer = new Uint8Array(await parquet.arrayBuffer());
			await this.db.registerFileBuffer(registeredFileName, buffer);
			return registeredFileName;
		}

		throw new Error('Unsupported parquet source. Use url, Blob/File, ArrayBuffer, or Uint8Array.');
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

	async getMarkers(): Promise<MarkersTable[]> {
		if (!this._markersColumn) {
			return [];
		}
		const sql = `SELECT * FROM markers ORDER BY ${this.tsColumnQuery}`;

		const result = await this.query(sql);
		return result.toArray().map((row) => ({
			...row,
			_ts: this.normalizeTimestampValue(row._ts)
		}));
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

		fields.forEach((f) => {
			if (
				TIMESTAMP_COLUMN_CANDIDATES.includes(f.name as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number])
			) {
				casts[f.name] = this.isTimestampLikeType(f.type) ? 'TIMESTAMP' : 'TIMESTAMP(ms)';
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

	private getTimestampSourceField(fields: ColumsSchema): ColumsSchema[number] | undefined {
		return fields.find((field) =>
			TIMESTAMP_COLUMN_CANDIDATES.includes(
				field.name as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number]
			)
		);
	}

	private isTimestampLikeType(type: string): boolean {
		return type.toUpperCase().includes('TIMESTAMP') || type.toUpperCase() === 'DATE';
	}

	private buildTimestampSelect(field: ColumsSchema[number]): string {
		const column = this.escapeIdent(field.name);
		if (this.isTimestampLikeType(field.type)) {
			return field.type.toUpperCase() === 'DATE' ? `CAST(${column} AS TIMESTAMP)` : column;
		}
		return this.sqlTimestampFromEpoch(column, 'ms');
	}

	private normalizeTimestampValue(value: unknown): number {
		if (value instanceof Date) {
			return value.getTime();
		}

		if (typeof value === 'bigint') {
			return Number(value);
		}

		return Number(value);
	}

	/**
	 * Build the casted type
	 */
	private buildCastedSelect(tempViewName: string, casts: Record<string, TargetType>): string {
		// Build the casted select
		const parts: string[] = [];

		for (const [col, target] of Object.entries(casts)) {
			const colSQL = this.escapeIdent(col);
			const isTimestampColumn = TIMESTAMP_COLUMN_CANDIDATES.includes(
				col as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number]
			);

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
				parts.push(`${colSQL} AS ${isTimestampColumn ? this._tsColumn : colSQL}`);
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
