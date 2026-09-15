import { escapeIdent, timestampToMilliseconds } from './utilities';
import { detectOHLCFromColumns, resolutionToInterval } from './ohlc';
import type { OHLCColumns, OHLCResolution } from './ohlc';
import type { DuckDBQueries } from './DuckDBQueries';
import type { Tables, TableData, DataRange, TimeSeriesData, TimeSeriesValue } from './types';
import { TIMESTAMP_COLUMN } from './types';

export type { OHLCColumns, OHLCResolution };

export class DuckDBTimeSeries<T extends Tables> {
	constructor(
		private queries: DuckDBQueries,
		private debug: boolean = false
	) {}

	get tsColumnQuery() {
		return escapeIdent(TIMESTAMP_COLUMN);
	}

	resolveOHLC(table: keyof T, columns: string[], config: TableData): OHLCColumns | undefined {
		if (config.candlestick === false) return undefined;
		if (config.candlestick) return config.candlestick;
		return detectOHLCFromColumns(columns);
	}

	async getOHLC(
		table: keyof T,
		ohlc: OHLCColumns,
		resolution?: OHLCResolution
	): Promise<TimeSeriesData> {
		const sql = resolution
			? this.buildOHLCResampledSQL(String(table), ohlc, resolution)
			: this.buildOHLCRawSQL(String(table), ohlc);

		const result = await this.queries.queryBatch(sql);

		const tsValues: number[] = [];
		const openValues: TimeSeriesValue[] = [];
		const highValues: TimeSeriesValue[] = [];
		const lowValues: TimeSeriesValue[] = [];
		const closeValues: TimeSeriesValue[] = [];

		for await (const batch of result) {
			const tsVec = batch.getChild(TIMESTAMP_COLUMN);
			const openVec = batch.getChild(ohlc.open);
			const highVec = batch.getChild(ohlc.high);
			const lowVec = batch.getChild(ohlc.low);
			const closeVec = batch.getChild(ohlc.close);

			if (!tsVec || !openVec || !highVec || !lowVec || !closeVec) {
				throw new Error('One or more OHLC columns not found in result.');
			}

			for (let i = 0; i < batch.numRows; i++) {
				tsValues.push(this.normalizeTimestampValue(tsVec.get(i)));
				openValues.push(this.normalizeDataValue(openVec.get(i)));
				highValues.push(this.normalizeDataValue(highVec.get(i)));
				lowValues.push(this.normalizeDataValue(lowVec.get(i)));
				closeValues.push(this.normalizeDataValue(closeVec.get(i)));
			}
		}

		return {
			[TIMESTAMP_COLUMN]: tsValues,
			[ohlc.open]: openValues,
			[ohlc.high]: highValues,
			[ohlc.low]: lowValues,
			[ohlc.close]: closeValues
		};
	}

	async getSingleDimension(table: keyof T, selectColumn: string, omitTimestamp = true) {
		const columnsSelect = [this.tsColumnQuery, escapeIdent(selectColumn)];

		const sql = `SELECT ${columnsSelect.join(', ')} FROM ${String(table)} ORDER BY ${this.tsColumnQuery}`;

		const result = await this.queries.queryBatch(sql);
		const tsKey = TIMESTAMP_COLUMN;

		const tsValues: number[] = [];
		const selectValues: TimeSeriesValue[] = [];

		for await (const batch of result) {
			const tsVector = batch.getChild(tsKey);
			const colVector = batch.getChild(selectColumn);

			if (!tsVector || !colVector) {
				throw new Error(`Column not found: ${!tsVector ? tsKey : selectColumn}`);
			}

			for (let i = 0; i < batch.numRows; i++) {
				selectValues.push(this.normalizeDataValue(colVector.get(i)));

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
				[TIMESTAMP_COLUMN]: tsValues,
				[selectColumn]: selectValues
			};
		}
	}

	async getRangeData(table: keyof T, start: number | string, end: number | string, limit?: number) {
		const view = escapeIdent(String(table));

		const startExp = typeof start === 'string' ? `'${start}'` : `${start}`;
		const endtExp = typeof end === 'string' ? `'${end}'` : `${end}`;
		const limitClause = limit ? `LIMIT ${limit}` : '';

		const sql = `
			SELECT *
			FROM ${view}
			WHERE ${TIMESTAMP_COLUMN} >= ${startExp} AND ${TIMESTAMP_COLUMN} < ${endtExp}
			ORDER BY "${TIMESTAMP_COLUMN}"
			${limitClause};
		`;

		return await this.queries.queryBatch(sql);
	}

	async getWindowedData(
		table: string,
		columns: string[],
		range: DataRange,
		maxPoints?: number
	): Promise<TimeSeriesData> {
		this.validatePointBudget(maxPoints);
		if (!columns.length) return { [TIMESTAMP_COLUMN]: [] };
		if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
			throw new Error('Window range must contain finite timestamps.');
		}

		const start = Math.trunc(Math.min(range.start, range.end));
		const end = Math.trunc(Math.max(range.start, range.end));
		const sql = this.buildWindowedSQL(table, columns, { start, end }, maxPoints);
		return this.queryWindowedData(sql, 'Unexpected null timestamp in windowed data.');
	}

	async getWindowedOHLC(
		table: string,
		columns: string[],
		ohlc: OHLCColumns,
		resolution: OHLCResolution | undefined,
		range: DataRange,
		maxPoints?: number
	): Promise<TimeSeriesData> {
		this.validatePointBudget(maxPoints);
		if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
			throw new Error('Window range must contain finite timestamps.');
		}

		const dimensions = [...new Set([...Object.values(ohlc), ...columns])];
		const normalizedRange = {
			start: Math.trunc(Math.min(range.start, range.end)),
			end: Math.trunc(Math.max(range.start, range.end))
		};
		const sql = resolution
			? this.buildWindowedOHLCResampledSQL(
					table,
					dimensions,
					ohlc,
					resolution,
					normalizedRange,
					maxPoints
				)
			: this.buildWindowedSQL(table, dimensions, normalizedRange, maxPoints);
		return this.queryWindowedData(sql, 'Unexpected null timestamp in windowed OHLC data.');
	}

	private async queryWindowedData(sql: string, nullTimestampError: string) {
		const tableResult = await this.queries.query(sql);
		const result: TimeSeriesData = {};
		const fieldNames = tableResult.schema.fields.map((field: any) => field.name);
		const vectors = fieldNames.map((name) => tableResult.getChild(name));
		for (const name of fieldNames) result[name] = [];

		for (let row = 0; row < tableResult.numRows; row++) {
			for (let column = 0; column < fieldNames.length; column++) {
				const name = fieldNames[column];
				const value = vectors[column]?.get(row);
				if (name === TIMESTAMP_COLUMN) {
					if (value == null) throw new Error(nullTimestampError);
					result[name].push(this.normalizeTimestampValue(value));
				} else {
					result[name].push(this.normalizeDataValue(value));
				}
			}
		}

		return result;
	}

	private buildWindowedSQL(
		table: string,
		columns: string[],
		range: DataRange,
		maxPoints?: number
	): string {
		const selectedColumns = [this.tsColumnQuery, ...columns.map((c) => escapeIdent(c))];
		const select = selectedColumns.join(', ');
		const view = escapeIdent(table);
		const windowFilter = `${this.tsColumnQuery} >= epoch_ms(${range.start})
			  AND ${this.tsColumnQuery} <= epoch_ms(${range.end})`;

		const sourceSql = `
			SELECT ${select}
			FROM ${view}
			WHERE ${windowFilter}
		`;

		return this.buildBudgetedSQL(sourceSql, selectedColumns, maxPoints);
	}

	private buildWindowedOHLCResampledSQL(
		table: string,
		columns: string[],
		ohlc: OHLCColumns,
		resolution: OHLCResolution,
		range: DataRange,
		maxPoints?: number
	): string {
		const interval = resolutionToInterval(resolution);
		const timestamp = this.tsColumnQuery;
		const selectedColumns = [timestamp, ...columns.map((column) => escapeIdent(column))];
		const ohlcColumns = new Set(Object.values(ohlc));
		const aggregations = [
			`FIRST(${escapeIdent(ohlc.open)} ORDER BY ${timestamp}) AS ${escapeIdent(ohlc.open)}`,
			`MAX(${escapeIdent(ohlc.high)}) AS ${escapeIdent(ohlc.high)}`,
			`MIN(${escapeIdent(ohlc.low)}) AS ${escapeIdent(ohlc.low)}`,
			`LAST(${escapeIdent(ohlc.close)} ORDER BY ${timestamp}) AS ${escapeIdent(ohlc.close)}`,
			...columns
				.filter((column) => !ohlcColumns.has(column))
				.map(
					(column) => `LAST(${escapeIdent(column)} ORDER BY ${timestamp}) AS ${escapeIdent(column)}`
				)
		];
		const bucket = `time_bucket(INTERVAL '${interval}', ${timestamp})`;
		const sourceSql = `
			SELECT
				${bucket} AS ${timestamp},
				${aggregations.join(',\n\t\t\t\t')}
			FROM ${escapeIdent(table)}
			WHERE ${timestamp} >= time_bucket(INTERVAL '${interval}', epoch_ms(${range.start}))
			  AND ${timestamp} < time_bucket(INTERVAL '${interval}', epoch_ms(${range.end}))
			      + INTERVAL '${interval}'
			GROUP BY 1
		`;

		return this.buildBudgetedSQL(sourceSql, selectedColumns, maxPoints);
	}

	private buildBudgetedSQL(
		sourceSql: string,
		selectedColumns: string[],
		maxPoints?: number
	): string {
		const select = selectedColumns.join(', ');
		if (maxPoints === undefined) {
			return `
				${sourceSql}
				ORDER BY ${this.tsColumnQuery}
			`;
		}

		const samplePredicate =
			maxPoints === 1
				? '__qts_sample_row = CAST(CEIL(__qts_sample_count / 2.0) AS BIGINT)'
				: `__qts_sample_row = 1
				  OR FLOOR((__qts_sample_row - 1) * ${maxPoints - 1}::DOUBLE / NULLIF(__qts_sample_count - 1, 0))
				     <> FLOOR((__qts_sample_row - 2) * ${maxPoints - 1}::DOUBLE / NULLIF(__qts_sample_count - 1, 0))`;

		return `
			WITH windowed AS (
				${sourceSql}
			), numbered AS (
				SELECT ${select},
					ROW_NUMBER() OVER (
						ORDER BY ${this.tsColumnQuery}, hash(${select})
					) AS __qts_sample_row,
					COUNT(*) OVER () AS __qts_sample_count
				FROM windowed
			)
			SELECT ${select}
			FROM numbered
			WHERE __qts_sample_count <= ${maxPoints}
			   OR (${samplePredicate})
			ORDER BY ${this.tsColumnQuery}, __qts_sample_row
		`;
	}

	private validatePointBudget(maxPoints?: number): void {
		if (
			maxPoints !== undefined &&
			(!Number.isFinite(maxPoints) || !Number.isInteger(maxPoints) || maxPoints <= 0)
		) {
			throw new Error('Point budget must be a finite positive integer.');
		}
	}

	async getDataBoundaries(table: string): Promise<DataRange> {
		const sql = `
			SELECT MIN(${this.tsColumnQuery}) as min_ts,
				   MAX(${this.tsColumnQuery}) as max_ts
			FROM ${escapeIdent(table)}
		`;
		const tableResult = await this.queries.query(sql);
		const minVal = tableResult.getChild('min_ts')?.get(0);
		const maxVal = tableResult.getChild('max_ts')?.get(0);
		return {
			start: timestampToMilliseconds(minVal ?? 0),
			end: timestampToMilliseconds(maxVal ?? 0)
		};
	}

	private buildOHLCRawSQL(table: string, ohlc: OHLCColumns): string {
		const cols = [
			this.tsColumnQuery,
			escapeIdent(ohlc.open),
			escapeIdent(ohlc.high),
			escapeIdent(ohlc.low),
			escapeIdent(ohlc.close)
		];
		return `SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${this.tsColumnQuery}`;
	}

	private buildOHLCResampledSQL(
		table: string,
		ohlc: OHLCColumns,
		resolution: OHLCResolution
	): string {
		const interval = resolutionToInterval(resolution);
		const ts = this.tsColumnQuery;
		const o = escapeIdent(ohlc.open);
		const h = escapeIdent(ohlc.high);
		const l = escapeIdent(ohlc.low);
		const c = escapeIdent(ohlc.close);

		return `
			SELECT
				time_bucket(INTERVAL '${interval}', ${ts}) AS ${TIMESTAMP_COLUMN},
				FIRST(${o} ORDER BY ${ts}) AS ${ohlc.open},
				MAX(${h})                  AS ${ohlc.high},
				MIN(${l})                  AS ${ohlc.low},
				LAST(${c} ORDER BY ${ts})  AS ${ohlc.close}
			FROM ${table}
			GROUP BY 1
			ORDER BY 1
		`;
	}

	private normalizeTimestampValue(value: unknown): number {
		if (value == null) {
			throw new Error('Unexpected null timestamp in time-series data.');
		}
		return timestampToMilliseconds(value);
	}

	private normalizeDataValue(value: unknown): TimeSeriesValue {
		return value == null ? null : Number(value);
	}
}
