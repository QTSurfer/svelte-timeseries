export { default as SvelteTimeSeries } from './component/SvelteTimeSeries.svelte';
export { default as TimeSeriesFacade } from './TimeSeriesFacade';
export { DuckDB } from './duckdb/DuckDB';
export { aggregateCandles } from '@qtsurfer/sveltecharts';
export type {
	AggregatedCandles,
	CandleInterval,
	CandlesInput,
	CandlesSource,
	InjectedLineStyle,
	InjectedMarker,
	InjectedMarkerKind,
	InjectedMarkerShape,
	InjectedSeries,
	NumericArray,
	PriceLineInput,
	PriceTicks,
	TickCandlesInput,
	TimeSeriesChartAdapter
} from '@qtsurfer/sveltecharts';
