import { escapeIdent, timestampToMilliseconds } from './utilities';
import { Schema, Table } from 'apache-arrow';
import { DuckDBConnection } from './DuckDBConnection';
import { DuckDBRegistry } from './DuckDBRegistry';
import { DuckDBQueries } from './DuckDBQueries';
import { DuckDBTimeSeries, type OHLCColumns, type OHLCResolution } from './DuckDBTimeSeries';
import { DuckDBMarkers } from './DuckDBMarkers';
import type { Tables, TableData, MarkersTableOptions, MarkersTable, DataRange } from './types';
import { TIMESTAMP_COLUMN } from './types';

export type { OHLCColumns, OHLCResolution };
export type {
	SingleResult,
	BinarySource,
	ParquetSource,
	TableData,
	Tables,
	MarkersTableOptions,
	MarkersTable,
	DataRange,
	TimeSeriesData,
	TimeSeriesValue,
	EpochUnit
} from './types';

export class DuckDB<T extends Tables> {
	private connection!: DuckDBConnection;
	private registry!: DuckDBRegistry<T>;
	private queries!: DuckDBQueries;
	private timeSeries!: DuckDBTimeSeries<T>;
	private markers!: DuckDBMarkers;

	private constructor(
		private _tables: T,
		private _markersColumn?: MarkersTableOptions,
		private debug: boolean = false
	) {}

	static async create<T extends Tables>(
		tables: T,
		markers?: MarkersTableOptions,
		debug: boolean = false
	): Promise<DuckDB<T>> {
		if (!window) throw new Error('DuckDB only works in a browser environment.');
		if (!window.Worker) throw new Error('No worker support?');

		const instance = new DuckDB<T>(tables, markers, debug);
		instance.connection = await DuckDBConnection.create(debug);
		instance.queries = new DuckDBQueries(instance.connection, debug);
		instance.registry = new DuckDBRegistry(
			instance.connection,
			instance.queries,
			tables,
			markers,
			debug
		);
		instance.timeSeries = new DuckDBTimeSeries<T>(instance.queries, debug);
		instance.markers = new DuckDBMarkers(instance.queries, markers);
		await instance.registry.load();
		return instance;
	}

	get tsColumnQuery() {
		return escapeIdent(TIMESTAMP_COLUMN);
	}

	getSchema(table: keyof T) {
		return this.registry.getSchema(table);
	}
	getColumns(table: keyof T) {
		return this.registry.getColumns(table);
	}
	getTable<K extends keyof T>(table: K) {
		return this.registry.getTable(table);
	}

	resolveOHLC(table: keyof T): OHLCColumns | undefined {
		return this.timeSeries.resolveOHLC(table, this.getColumns(table), this.getTable(table));
	}

	getOHLC(table: keyof T, ohlc: OHLCColumns, resolution?: OHLCResolution) {
		return this.timeSeries.getOHLC(table, ohlc, resolution);
	}

	getSingleDimension(table: keyof T, column: string, omitTimestamp = true) {
		return this.timeSeries.getSingleDimension(table, column, omitTimestamp);
	}

	getRangeData(table: keyof T, start: number | string, end: number | string, limit?: number) {
		return this.timeSeries.getRangeData(table, start, end, limit);
	}

	getWindowedData(table: string, columns: string[], range: DataRange, limit?: number) {
		return this.timeSeries.getWindowedData(table, columns, range, limit);
	}

	getWindowedOHLC(
		table: string,
		columns: string[],
		ohlc: OHLCColumns,
		resolution: OHLCResolution | undefined,
		range: DataRange,
		limit?: number
	) {
		return this.timeSeries.getWindowedOHLC(table, columns, ohlc, resolution, range, limit);
	}

	getDataBoundaries(table: string) {
		return this.timeSeries.getDataBoundaries(table);
	}

	getMarkers(): Promise<MarkersTable[]> {
		return this.markers.getMarkers();
	}

	query(sql: string) {
		return this.queries.query(sql);
	}
	queryBatch(statement: string) {
		return this.queries.queryBatch(statement);
	}

	async getSingle<R>(query: string): Promise<R> {
		return this.queries.getSingle<R>(query);
	}

	async count(table: keyof T): Promise<number> {
		return this.queries.count(String(table));
	}

	get tables() {
		return this._tables;
	}

	async closeConnection(): Promise<void> {
		await this.connection?.close();
	}

	getColumnTypeName(table: keyof T, column: string): string {
		return (
			this.getSchema(table)
				.fields.find((f) => f.name === column)
				?.type.toString() ?? ''
		);
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
				if (columns[j] === TIMESTAMP_COLUMN) {
					if (typeof value === 'bigint' || value instanceof Date) {
						value = timestampToMilliseconds(value);
					}
				}
				row[j] = value;
			}
			rows[i] = row;
		}

		return [rows, columns];
	}
}
