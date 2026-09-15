import type { OHLCColumns, OHLCResolution } from './ohlc';
export type { OHLCColumns, OHLCResolution };

export type SingleResult = string | number;
export type TimeSeriesValue = number | null;
export type TimeSeriesData = Record<string, TimeSeriesValue[]>;

export const TIMESTAMP_COLUMN = '_ts' as const;
export const TIMESTAMP_COLUMN_CANDIDATES = ['_ts', 'ts', '_t', 't'] as const;

export type MarkersTableOptions = {
	table: string;
	targetColumn: string;
	targetDimension: string;
};

export type BinarySource = Blob | ArrayBuffer | Uint8Array;
/** @deprecated Use BinarySource */
export type ParquetSource = BinarySource;

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

type TableDataBase = {
	mainColumn: string;
	columnsSelect?: string[];
	candlestick?: OHLCColumns | false;
	resolution?: OHLCResolution;
	timestampUnit?: EpochUnit;
};

type TableDataFromUrl = TableDataBase & {
	url: string;
	parquet?: never;
	lastra?: never;
};

type TableDataFromParquet = TableDataBase & {
	url?: never;
	parquet: BinarySource;
	lastra?: never;
};

type TableDataFromLastra = TableDataBase & {
	url?: never;
	parquet?: never;
	lastra: BinarySource;
};

export type TableData = TableDataFromUrl | TableDataFromParquet | TableDataFromLastra;
export type Tables = Record<string, TableData>;

export type IconType =
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
	[TIMESTAMP_COLUMN]: number;
	shape: IconType;
	color: string;
	position: string;
	text: string;
};

export type ColumnsSchema = { name: string; type: string }[];

export type DuckDBType =
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

export type TargetType = DuckDBType | `TIMESTAMP(${EpochUnit})`;

export interface DataRange {
	start: number;
	end: number;
}
