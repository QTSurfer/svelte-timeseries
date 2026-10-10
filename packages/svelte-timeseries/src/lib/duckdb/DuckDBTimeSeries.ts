import { escapeIdent, timestampToMilliseconds } from './utilities';
import {
	detectOHLCFromColumns,
	isTickerSchema,
	resolutionToInterval,
	tickCandleColumns
} from './ohlc';
import type { OHLCColumns, OHLCResolution } from './ohlc';
import type { DuckDBQueries } from './DuckDBQueries';
import type { Tables, TableData, DataRange, TimeSeriesData, TimeSeriesValue } from './types';
import { TIMESTAMP_COLUMN } from './types';

export type { OHLCColumns, OHLCResolution };

/** Candles built from the ticks of one price column (see `TickCandlestick`). */
export type TickCandles = {
	/** The price column that is aggregated. */
	price: string;
	/** Names of the bar columns the aggregation produces. */
	columns: OHLCColumns;
	/** Bucket size. Without it ticks cannot be drawn as candles. */
	resolution?: OHLCResolution;
	/** `true` when the table was recognized as a ticker feed, `false` when the config asked for it. */
	detected: boolean;
};

export class DuckDBTimeSeries<T extends Tables> {
	constructor(
		private queries: DuckDBQueries,
		private debug: boolean = false
	) {}

	get tsColumnQuery() {
		return escapeIdent(TIMESTAMP_COLUMN);
	}

	/**
	 * Bar columns to draw as candles, if any. A ticker feed is never reported here: its open / high /
	 * low are rolling statistics, not bar prices (see `resolveTickCandles`). An explicit
	 * `candlestick` mapping is always honored.
	 */
	resolveOHLC(table: keyof T, columns: string[], config: TableData): OHLCColumns | undefined {
		if (config.candlestick === false) return undefined;
		if (config.candlestick) return 'price' in config.candlestick ? undefined : config.candlestick;
		const detected = detectOHLCFromColumns(columns);
		return detected && !isTickerSchema(columns) ? detected : undefined;
	}

	/**
	 * Candles to aggregate from the ticks of a price column, if the table asks for them
	 * (`candlestick: { price }`) or is recognized as a ticker feed (OHLC-looking columns plus `bid`
	 * and `ask`, see `isTickerSchema`) and has no explicit `candlestick` setting. The price of a
	 * detected ticker is the column that would have been its close.
	 */
	resolveTickCandles(
		table: keyof T,
		columns: string[],
		config: TableData
	): TickCandles | undefined {
		const candlestick = config.candlestick;
		if (candlestick === false) return undefined;

		let price: string | undefined;
		let detected = false;
		if (candlestick) {
			if (!('price' in candlestick)) return undefined;
			price = columns.find((column) => column.toLowerCase() === candlestick.price.toLowerCase());
			if (!price) {
				throw new Error(
					`Candlestick price column "${candlestick.price}" not found in ${String(table)}. Available: ${columns.join(', ')}.`
				);
			}
		} else if (isTickerSchema(columns)) {
			price = detectOHLCFromColumns(columns)?.close;
			detected = true;
		}
		if (!price) return undefined;

		return {
			price,
			columns: tickCandleColumns(price, columns),
			resolution: config.resolution,
			detected
		};
	}

	/**
	 * OHLC bars of a table. With `price`, every bar is aggregated from the ticks of that column over
	 * `resolution` buckets (required) and `ohlc` only names the output columns; without it the
	 * `ohlc` columns are the bar prices.
	 */
	async getOHLC(
		table: keyof T,
		ohlc: OHLCColumns,
		resolution?: OHLCResolution,
		price?: string
	): Promise<TimeSeriesData> {
		if (price !== undefined && !resolution) {
			throw new Error('Candles built from a price column need a resolution.');
		}
		const sql = resolution
			? this.buildOHLCResampledSQL(String(table), ohlc, resolution, price)
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
		maxPoints?: number,
		price?: string
	): Promise<TimeSeriesData> {
		this.validatePointBudget(maxPoints);
		if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
			throw new Error('Window range must contain finite timestamps.');
		}
		if (price !== undefined && !resolution) {
			throw new Error('Candles built from a price column need a resolution.');
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
					maxPoints,
					price
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
		maxPoints?: number,
		price?: string
	): string {
		const interval = resolutionToInterval(resolution);
		const timestamp = this.tsColumnQuery;
		const selectedColumns = [timestamp, ...columns.map((column) => escapeIdent(column))];
		const ohlcColumns = new Set(Object.values(ohlc));
		// With a price column all four bar values come from it; `ohlc` only names the outputs.
		const source = (column: string) => escapeIdent(price ?? column);
		const aggregations = [
			`FIRST(${source(ohlc.open)} ORDER BY ${timestamp}) AS ${escapeIdent(ohlc.open)}`,
			`MAX(${source(ohlc.high)}) AS ${escapeIdent(ohlc.high)}`,
			`MIN(${source(ohlc.low)}) AS ${escapeIdent(ohlc.low)}`,
			`LAST(${source(ohlc.close)} ORDER BY ${timestamp}) AS ${escapeIdent(ohlc.close)}`,
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
			      + INTERVAL '${interval}'${price === undefined ? '' : `\n\t\t\t  AND ${escapeIdent(price)} IS NOT NULL`}
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
		resolution: OHLCResolution,
		price?: string
	): string {
		const interval = resolutionToInterval(resolution);
		const ts = this.tsColumnQuery;
		// With a price column all four bar values come from it and `ohlc` only names the outputs.
		// Ticks without a price are left out so they cannot open or close a bar.
		const o = escapeIdent(price ?? ohlc.open);
		const h = escapeIdent(price ?? ohlc.high);
		const l = escapeIdent(price ?? ohlc.low);
		const c = escapeIdent(price ?? ohlc.close);
		const alias = (name: string) => (price === undefined ? name : escapeIdent(name));
		const where = price === undefined ? '' : `WHERE ${c} IS NOT NULL`;

		return `
			SELECT
				time_bucket(INTERVAL '${interval}', ${ts}) AS ${TIMESTAMP_COLUMN},
				FIRST(${o} ORDER BY ${ts}) AS ${alias(ohlc.open)},
				MAX(${h})                  AS ${alias(ohlc.high)},
				MIN(${l})                  AS ${alias(ohlc.low)},
				LAST(${c} ORDER BY ${ts})  AS ${alias(ohlc.close)}
			FROM ${table}
			${where}
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
