import type { EChartsOption } from '@qtsurfer/sveltecharts';
import { DuckDB } from './duckdb/DuckDB';

type IndexedField = {
	idx: number;
	name: string;
};

type DataSource = { [key: number]: number[] };

export type ColumnConfig = {
	tsColumn?: string;
	mainColumn?: string;
};

export class DuckChart {
	private db!: DuckDB;
	private tsColumn!: string; // Timestamp column name
	private tsCastType!: string; // Timestamp cast type
	private mainColumn!: string; // Main column name
	private zoomStart = 38;
	private zoomEnd = 62;
	private _debug = false;
	public option: EChartsOption; // ECharts configuration

	// Arrays to store column metadata
	public columns: string[] = [];
	public indexedFields: IndexedField[] = [];
	public mainFields: IndexedField[] = [];
	public percentFields: IndexedField[] = [];

	// Data containers
	private globalSource: DataSource = {};
	private globalTimestamps: number[] = [];

	constructor() {
		this.option = {
			tooltip: {
				trigger: 'axis',
				axisPointer: {
					animation: false,
					type: 'cross',
					lineStyle: {
						color: '#cab',
						width: 2,
						opacity: 1
					}
				}
			},
			grid: {
				bottom: '12%'
			},
			dataZoom: [
				{
					id: 'mainZoom',
					type: 'slider',
					filterMode: 'none',
					realtime: false,
					start: this.zoomStart,
					end: this.zoomEnd
				},
				{
					id: 'mainZoomInside',
					type: 'inside'
				}
			],
			xAxis: {
				type: 'time',
				axisLine: { show: true }
			},
			yAxis: [
				{
					type: 'value',
					scale: true,
					splitLine: { show: false },
					axisLine: { show: true, lineStyle: { type: 'dashed' } }
				},
				{
					type: 'value',
					scale: true,
					splitLine: { show: false },
					axisLine: { show: true, lineStyle: { type: 'dashed' } },
					axisLabel: {
						formatter: '{value} %'
					},
					name: '%'
				}
			],
			dataset: [],
			series: []
		};
	}

	/** Initialize DuckDB in WASM */
	public async initDB(): Promise<void> {
		this.db = await DuckDB.create(this._debug);
	}

	/** Enable/disable debug mode */
	set debug(enabled: boolean) {
		this._debug = enabled;
		if (this.db) {
			this.db.debug = enabled;
		}
	}

	/** Check if debug mode is enabled */
	get debug(): boolean {
		return this._debug;
	}

	/**
	 * Load global/overview data.
	 * Example: only timestamp and main columns.
	 * This is to have a minimal dataset for dataZoom or global timeline.
	 */
	public async load(url: string,columnConfig? : ColumnConfig): Promise<void> {
		if (this.db.table === url) {
			return;
		}
		this.db.table = url;

		await this.detectFields(columnConfig);

		const query = `
            SELECT ${this.getTsCast()}, "${this.mainColumn}"
            FROM "${this.db.table}"
            WHERE "${this.mainColumn}" != 0
            ORDER BY "${this.tsColumn}"
        `;

		// Clear previous arrays
		this.globalTimestamps = [];
		this.globalSource[0] = []; // For timestamps
		this.globalSource[1] = []; // For main column

		// Build a single dataset for the global/overview series
		const globalDataset = {
			source: this.globalSource
		};

		this.option.series = [
			{
				name: this.mainColumn,
				type: 'line',
				animation: false,
				showSymbol: false,
				symbol: 'none',
				sampling: 'lttb',
				encode: { x: 0, y: 1 },
				lineStyle: { width: 3, opacity: 1, color: '#8d8' }
			}
		];
		this.option.dataset = [globalDataset];
		this.option.legend = {
			data: [this.mainColumn]
		};

		const startTime = performance.now();
		const results = await this.db.queryBatch(query);

		for await (const batch of results) {
			const batchTimestamps = batch.data.children[0].values; // timestamps
			const dateArray: number[] = Array.from(batchTimestamps, (ts) => Number(ts));
			this.globalTimestamps.push(...dateArray);
			this.globalSource[0] = this.globalTimestamps;

			const batchPrice = batch.data.children[1].values; // main column
			this.globalSource[1].push(...batchPrice);
		}

		const endTime = performance.now();
		if (this.debug)
			console.log(
				`Global data loaded. Rows: ${this.globalTimestamps.length} in ${endTime - startTime} ms`
			);
		await this.loadRange(this.zoomStart, this.zoomEnd);
	}

	/**
	 * Load detailed data by time range.
	 * Uses the stored mainFields/percentFields for a generic approach.
	 * @param start Start percentage (0-100)
	 * @param end End percentage (0-100)
	 */
	public async loadRange(start: number, end: number): Promise<void> {
		const startTs = this.percentToTimestamp(start);
		const endTs = this.percentToTimestamp(end);

		const selectedFields = [...this.mainFields, ...this.percentFields];
		const fieldsStr = selectedFields.map((f) => `"${f.name}"`).join(',');
		const query = `
            SELECT ${this.getTsCast()}, ${fieldsStr}
            FROM "${this.db.table}"
            WHERE ${this.getTsCast()} >= ${this.getTsValueCast(startTs)} 
			AND ${this.getTsCast()} <= ${this.getTsValueCast(endTs)} 
			AND "${this.mainColumn}" != 0
            ORDER BY "${this.tsColumn}"
        `;
		if (this.debug) {
			console.log('Query:', query);
			console.log('Loading range:', startTs, endTs);
		}

		const detailSource: DataSource = {};
		detailSource[0] = []; // For timestamps
		selectedFields.forEach((_, idx) => {
			detailSource[idx + 1] = [];
		});

		const startTime = performance.now();
		const results = await this.db.queryBatch(query);
		let rowsCount = 0;

		for await (const batch of results) {
			if (rowsCount === 0 && this.debug) console.log('Batch:', batch);
			const batchTimestamps = batch.data.children[0].values;
			const dateArray: number[] = Array.from(batchTimestamps, (ts) => Number(ts));
			detailSource[0].push(...dateArray); // timestamps
			selectedFields.forEach((_, idx) => {
				detailSource[idx + 1].push(...batch.data.children[idx + 1].values);
			});
			rowsCount += batch.data.length;
		}

		// Now we want to unify the global dataset (index 0) with a new dataset for detail (index 1)
		// The detail dataset has all columns, so let's build a new dataset reference:
		const detailDataset = {
			source: detailSource
		};

		this.option.dataset = [{ source: this.globalSource }, detailDataset];

		// Build the series array using selectedFields
		const newSeries: any[] = [];
		// @ts-ignore
		newSeries.push(this.option.series[0]); // Copy the global main column series
		let seriesIdx = 0; // For referencing dataset columns beyond timestamps

		for (const f of selectedFields) {
			seriesIdx++;
			newSeries.push({
				name: f.name,
				type: 'line',
				animation: false,
				datasetIndex: 1,
				showSymbol: false,
				symbol: 'none',
				sampling: 'lttb',
				encode: { x: 0, y: seriesIdx },
				lineStyle: {
					width: 1,
					opacity: 1
				},
				yAxisIndex: f.name.endsWith('%') ? 1 : 0
			});
		}

		this.option.series = newSeries;
		this.option.legend = {
			data: [this.mainColumn, ...selectedFields.map((f) => f.name)]
		};

		const endTime = performance.now();
		if (this.debug)
			console.log(`Range data loaded: ${rowsCount} rows in ${endTime - startTime} ms`);
	}

	/**
	 * Load the list of columns and identify main/percent fields.
	 * This is a generic metadata step.
	 */
	private async detectFields(columnConfig? : ColumnConfig): Promise<void> {
		this.columns = await this.db.getColumnNames();
		this.indexedFields = this.columns.map((name, idx) => ({ idx, name }));

		this.mainFields = this.indexedFields.filter(
			(f) => !f.name.startsWith('_') && !f.name.endsWith('%')
		);
		this.percentFields = this.indexedFields.filter(
			(f) => !f.name.startsWith('_') && f.name.endsWith('%')
		);
		this.tsColumn = columnConfig?.tsColumn ?? this.columns[0];
		this.mainColumn = columnConfig?.mainColumn ?? this.mainFields[1].name;
		this.mainFields = this.mainFields.filter((f) => f.name !== this.tsColumn); // Remove timestamp from main fields
		this.tsCastType = await this.getTimestampCastType();
		if (this.debug) {
			console.log('Schema:', await this.db.getSchema());
			console.log('Columns:', this.columns);
			console.log('Main fields:', this.mainFields);
			console.log('Percent fields:', this.percentFields);
			console.log('Timestamp column:', this.tsColumn);
			console.log('Timestamp cast type:', this.tsCastType || 'none');
			console.log('Main column:', this.mainColumn);
		}
	}

	private getTimestampCastType(): string {
		const typeName = this.db.getColumnTypeName(this.tsColumn).toLowerCase();
		if (this.debug) console.log('Timestamp column type:', typeName);
		return typeName;
	}

	private getTsCast(): string {
		switch (this.tsCastType) {
			case 'timestamp<microsecond>':
				return `epoch_ms("${this.tsColumn}")`;
			case 'int64':
				break;
			default:
				console.warn('Unsupported timestamp cast type:', this.tsCastType);
		}
		return `"${this.tsColumn}"`;
	}

	private getTsValueCast(ts: number): string {
		if (this.tsCastType.startsWith('timestamp')) {
			return (ts / 1000).toString();
		}
		return ts.toString();
	}

	/**
	 * Convert a percentage to a timestamp from the loaded timeline.
	 * @param percent
	 * @returns timestamp
	 */
	private percentToTimestamp(percent: number): number {
		if (percent < 0 || percent > 100) return 0;
		if (percent === 0) return this.globalTimestamps[0];
		if (percent === 100) return this.globalTimestamps[this.globalTimestamps.length - 1];
		return this.globalTimestamps[Math.floor((percent / 100) * this.globalTimestamps.length)];
	}
}
