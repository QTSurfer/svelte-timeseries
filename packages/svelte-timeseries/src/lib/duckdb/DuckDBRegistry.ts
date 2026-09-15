import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { escapeIdent } from './utilities';
import { Schema } from 'apache-arrow';
import { DuckDBDataProtocol } from '@duckdb/duckdb-wasm';
import type { DuckDBConnection } from './DuckDBConnection';
import type { DuckDBQueries } from './DuckDBQueries';
import type {
	Tables,
	TableData,
	ColumnsSchema,
	TargetType,
	EpochUnit,
	MarkersTableOptions
} from './types';
import { TIMESTAMP_COLUMN, TIMESTAMP_COLUMN_CANDIDATES } from './types';

export class DuckDBRegistry<T extends Tables> {
	private _schemas: Partial<Record<keyof T, Schema>> = {};

	constructor(
		private connection: DuckDBConnection,
		private queries: DuckDBQueries,
		private _tables: T,
		private _markersColumn?: MarkersTableOptions,
		private debug: boolean = false
	) {}

	async load(): Promise<void> {
		if (this.hasLastraTables()) {
			await this.loadLastraExtension();
		}
		await this.registerData();
	}

	getSchema(table: keyof T): Schema {
		if (!this._schemas[table]) throw new Error(`Schema for ${String(table)} not initialized`);
		return this._schemas[table]!;
	}

	getColumns(table: keyof T): string[] {
		return this.getSchema(table)
			.fields.filter((f) => f.name !== TIMESTAMP_COLUMN)
			.map((f) => f.name);
	}

	getTable(table: keyof T): TableData {
		return this._tables[table];
	}

	getTimestampColumn(): string {
		return TIMESTAMP_COLUMN;
	}

	private hasLastraTables(): boolean {
		return Object.values(this._tables).some((t) => this.resolveFormat(t) === 'lastra');
	}

	private async loadLastraExtension(): Promise<void> {
		await this.queries.execute(async (conn) => {
			await conn.query('INSTALL lastra FROM community; LOAD lastra;');
		}, 'loadLastraExtension');
	}

	private async registerData() {
		for (const [name, data] of Object.entries(this._tables) as [keyof T, TableData][]) {
			await this.buildTablesAndSchemas(name, data);
		}
	}

	private async buildTablesAndSchemas(name: keyof T, tableConfiguration: TableData) {
		return await this.queries.execute(async (conn) => {
			if (this.debug) console.log('Registering tables and schemas...');

			const viewName = String(name);
			const tempViewName = `__temp_${viewName}`;
			const format = this.resolveFormat(tableConfiguration);
			const sourcePath = await this.registerFileSource(viewName, tableConfiguration, format);
			const scanFn = format === 'lastra' ? 'read_lastra' : 'parquet_scan';

			const columnsSelect = tableConfiguration?.columnsSelect?.map((c) => escapeIdent(c)) ?? ['*'];

			if (this._markersColumn?.table === viewName) {
				columnsSelect.push(this._markersColumn.targetColumn);
			}

			const selectColumns = columnsSelect.join(', ');

			await conn.query(
				`CREATE OR REPLACE VIEW ${escapeIdent(tempViewName)} AS SELECT ${selectColumns} FROM ${scanFn}('${sourcePath}')`
			);

			const initialSchemaData = await conn.query(
				`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = '${tempViewName}'`
			);

			const initialSchema: ColumnsSchema = initialSchemaData.toArray();
			const sourceTimestampField = this.getTimestampSourceField(initialSchema);

			if (!sourceTimestampField) {
				throw new Error(
					`Time column not found in "${viewName}". Expected one of: ${TIMESTAMP_COLUMN_CANDIDATES.join(', ')}`
				);
			}

			const timestampUnit = await this.resolveTimestampUnit(
				conn,
				tempViewName,
				sourceTimestampField,
				tableConfiguration
			);
			const targetCasts = this.autoDetectFields(initialSchema, timestampUnit);
			const castedSelect = this.buildCastedSelect(tempViewName, targetCasts);

			await conn.query(`CREATE OR REPLACE VIEW ${escapeIdent(viewName)} AS ${castedSelect}`);

			if (this._markersColumn?.table === viewName) {
				const columnsSelect = [
					`${this.buildTimestampSelect(sourceTimestampField, timestampUnit)} AS ${TIMESTAMP_COLUMN}`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.shape') AS VARCHAR), '^"(.*)"$', '\\1') AS shape`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.color') AS VARCHAR), '^"(.*)"$', '\\1') AS color`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.position') AS VARCHAR), '^"(.*)"$', '\\1') AS position`,
					`regexp_replace(CAST(json_extract(${this._markersColumn.targetColumn}, '$.text') AS VARCHAR), '^"(.*)"$', '\\1') AS text`
				];
				const selectMarkers = `SELECT ${columnsSelect.join(', ')} FROM ${escapeIdent(tempViewName)} WHERE ${this._markersColumn.targetColumn} IS NOT NULL AND json_valid(${this._markersColumn.targetColumn})`;
				await conn.query(`CREATE OR REPLACE VIEW markers AS ${selectMarkers}`);
			}

			const { schema: finalSchema } = await conn.query(
				`SELECT * FROM ${escapeIdent(viewName)} LIMIT 0`
			);

			if (this.debug) {
				console.log(`Registered table ${viewName}`);
			}

			this._schemas[name] = finalSchema;

			return finalSchema;
		}, 'buildTablesAndSchemas - ' + name.toString());
	}

	private resolveFormat(tableConfiguration: TableData): 'parquet' | 'lastra' {
		if ('lastra' in tableConfiguration && tableConfiguration.lastra) return 'lastra';
		if (tableConfiguration.url?.endsWith('.lastra')) return 'lastra';
		return 'parquet';
	}

	private async registerFileSource(
		viewName: string,
		tableConfiguration: TableData,
		format: 'parquet' | 'lastra'
	): Promise<string> {
		if (tableConfiguration.url !== undefined) {
			return tableConfiguration.url;
		}

		const ext = format === 'lastra' ? 'lastra' : 'parquet';
		const registeredFileName = `${viewName}.${ext}`;
		const source =
			'lastra' in tableConfiguration ? tableConfiguration.lastra : tableConfiguration.parquet;

		if (source instanceof Uint8Array) {
			await this.connection.database.registerFileBuffer(registeredFileName, source);
			return registeredFileName;
		}

		if (source instanceof ArrayBuffer) {
			await this.connection.database.registerFileBuffer(registeredFileName, new Uint8Array(source));
			return registeredFileName;
		}

		if (source instanceof Blob) {
			if (typeof File !== 'undefined' && source instanceof File) {
				await this.connection.database.registerFileHandle(
					registeredFileName,
					source,
					DuckDBDataProtocol.BROWSER_FILEREADER,
					true
				);
				return registeredFileName;
			}

			const buffer = new Uint8Array(await source.arrayBuffer());
			await this.connection.database.registerFileBuffer(registeredFileName, buffer);
			return registeredFileName;
		}

		throw new Error('Unsupported source. Use url, Blob/File, ArrayBuffer, or Uint8Array.');
	}

	private async resolveTimestampUnit(
		conn: AsyncDuckDBConnection,
		tempViewName: string,
		field: ColumnsSchema[number],
		tableConfiguration: TableData
	): Promise<EpochUnit> {
		if (tableConfiguration.timestampUnit) return tableConfiguration.timestampUnit;
		if (this.isTimestampLikeType(field.type)) return 'ms';

		const column = escapeIdent(field.name);
		const result = await conn.query(
			`SELECT MAX(ABS(CAST(${column} AS DOUBLE))) AS timestamp_magnitude FROM ${escapeIdent(tempViewName)}`
		);
		const magnitude = Number(result.toArray()[0]?.timestamp_magnitude);

		return this.inferEpochUnit(magnitude, field.name);
	}

	private inferEpochUnit(magnitude: number, fieldName: string): EpochUnit {
		if (magnitude >= 1e17) return 'ns';
		if (magnitude >= 1e14) return 'us';
		if (magnitude >= 1e11) return 'ms';
		if (magnitude >= 1e8) return 's';

		throw new Error(
			`Cannot infer epoch unit for numeric timestamp column "${fieldName}". Set timestampUnit to 's', 'ms', 'us', or 'ns'.`
		);
	}

	private autoDetectFields(
		fields: ColumnsSchema,
		timestampUnit: EpochUnit
	): Record<string, TargetType> {
		const casts: Record<string, TargetType> = {};

		fields.forEach((f) => {
			if (
				TIMESTAMP_COLUMN_CANDIDATES.includes(f.name as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number])
			) {
				casts[f.name] = this.isTimestampLikeType(f.type)
					? 'TIMESTAMP'
					: `TIMESTAMP(${timestampUnit})`;
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

			casts[f.name] = (f.type?.toString()?.toUpperCase() as any) ?? 'VARCHAR';
		});

		return casts;
	}

	private getTimestampSourceField(fields: ColumnsSchema): ColumnsSchema[number] | undefined {
		return fields.find((field) =>
			TIMESTAMP_COLUMN_CANDIDATES.includes(
				field.name as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number]
			)
		);
	}

	private isTimestampLikeType(type: string): boolean {
		return type.toUpperCase().includes('TIMESTAMP') || type.toUpperCase() === 'DATE';
	}

	private buildTimestampSelect(field: ColumnsSchema[number], timestampUnit: EpochUnit): string {
		const column = escapeIdent(field.name);
		if (this.isTimestampLikeType(field.type)) {
			return field.type.toUpperCase() === 'DATE' ? `CAST(${column} AS TIMESTAMP)` : column;
		}
		return this.sqlTimestampFromEpoch(column, timestampUnit);
	}

	private sqlTimestampFromEpoch(colSQL: string, unit: EpochUnit): string {
		if (unit === 'ms') return `epoch_ms(${colSQL})`;
		if (unit === 's') return `TIMESTAMP '1970-01-01' + (${colSQL} * INTERVAL 1 SECOND)`;
		if (unit === 'us') return `TIMESTAMP '1970-01-01' + (${colSQL} * INTERVAL 1 MICROSECOND)`;
		return `TIMESTAMP '1970-01-01' + ((${colSQL} / 1000) * INTERVAL 1 MICROSECOND)`;
	}

	private buildCastedSelect(tempViewName: string, casts: Record<string, TargetType>): string {
		const parts: string[] = [];

		for (const [col, target] of Object.entries(casts)) {
			const colSQL = escapeIdent(col);
			const isTimestampColumn = TIMESTAMP_COLUMN_CANDIDATES.includes(
				col as (typeof TIMESTAMP_COLUMN_CANDIDATES)[number]
			);

			const m = typeof target === 'string' ? target.match(/^TIMESTAMP\((s|ms|us|ns)\)$/i) : null;
			if (m) {
				const unit = m[1].toLowerCase() as EpochUnit;
				const sql = `${this.sqlTimestampFromEpoch(colSQL, unit)} AS ${TIMESTAMP_COLUMN}`;
				parts.push(sql);
				continue;
			}

			if (target === 'TIMESTAMP') {
				parts.push(`${colSQL} AS ${isTimestampColumn ? TIMESTAMP_COLUMN : colSQL}`);
				continue;
			}

			parts.push(`CAST(${colSQL} AS ${target}) AS ${colSQL}`);
		}

		return `SELECT ${parts.join(', ')} FROM ${escapeIdent(tempViewName)}`;
	}
}
