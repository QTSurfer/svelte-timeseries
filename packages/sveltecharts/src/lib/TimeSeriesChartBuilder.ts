import type { EChartsOption, SeriesOption, LineSeriesOption } from 'echarts';

type Row = number[]; // [time, v1, v2, ...]

export class TimeSeriesChartBuilder {
	private option: EChartsOption;
	private pendingSeriesNames?: string[];

	constructor() {
		this.option = {
			title: {},
			tooltip: {},
			legend: {},
			grid: {},
			xAxis: {
				type: 'time'
			},
			yAxis: {
				type: 'value',
				scale: true
			},
			dataset: { source: [] },
			series: []
		};
	}

	/**
	 * Accepts data as rows: [timestamp, v1, v2, ...]
	 * Automatically generates line series for each value column (>=1).
	 */
	setDataset(data: Row[]): this {
		this.option.dataset = { source: data };

		// Build series based on number of columns (minus the time column).
		const columns = Array.isArray(data) && data.length > 0 ? data[0].length : 0;
		const valueCols = Math.max(0, columns - 1);

		const series: SeriesOption[] = [];
		for (let i = 1; i <= valueCols; i++) {
			const s: LineSeriesOption = {
				type: 'line',
				name: `Series ${i}`,
				encode: { x: 0, y: i },
				emphasis: { focus: 'series' },
				showSymbol: false, // good default for dense timeseries
				sampling: 'lttb' // improves perf for large datasets
			};
			series.push(s);
		}
		this.option.series = series;

		// Apply pending series names if they were set before dataset
		if (this.pendingSeriesNames && Array.isArray(this.option.series)) {
			const names = this.pendingSeriesNames;
			this.option.series = (this.option.series as SeriesOption[]).map((s, idx) => ({
				...(s as object),
				name: names[idx] ?? (s as any).name
			})) as SeriesOption[];
		}

		return this;
	}

	/**
	 * Tooltip bound to axis with a crosshair pointer.
	 */
	setAxisTooltip(): this {
		this.option.tooltip = {
			trigger: 'axis',
			axisPointer: { type: 'cross' }
		};
		return this;
	}

	/**
	 * Legend with a custom icon (e.g., 'circle', 'rect').
	 */
	setLegendIcon(icon: string): this {
		this.option.legend = {
			show: true,
			icon,
			top: 10
		};
		return this;
	}

	/**
	 * Adds both inside and slider dataZoom.
	 */
	setDataZoom(): this {
		this.option.dataZoom = [
			{ type: 'inside' },
			{
				type: 'slider',
				height: 24,
				bottom: 10
			}
		];
		return this;
	}

	/**
	 * Sets chart title and optional subtitle, centered.
	 */
	setTitle(text: string, subtext?: string): this {
		this.option.title = {
			text,
			subtext,
			left: 'center'
		};
		return this;
	}

	/**
	 * Applies a partial style to all existing series (e.g., { smooth: true, symbol: 'none' }).
	 */
	setSeriesStyle(style: Partial<LineSeriesOption>): this {
		if (Array.isArray(this.option.series)) {
			this.option.series = this.option.series.map((s) => ({
				...(s as object),
				...(style as object)
			})) as SeriesOption[];
		}
		return this;
	}

	/**
	 * Sets the display names for the generated series. If called before setDataset,
	 * names are stored and applied once the dataset creates the series.
	 */
	setSeriesNames(names: string[]): this {
		this.pendingSeriesNames = names;
		if (Array.isArray(this.option.series) && this.option.series.length > 0) {
			this.option.series = (this.option.series as SeriesOption[]).map((s, idx) => ({
				...(s as object),
				name: names[idx] ?? (s as any).name
			})) as SeriesOption[];
		}
		return this;
	}

	/**
	 * Returns the built ECharts option.
	 */
	build(): EChartsOption {
		// Shallow clone is fine for typical ECharts options here.
		return { ...this.option };
	}
}
