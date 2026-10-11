/**
 * The pure helpers of the package, as a separate entry point: `@qtsurfer/sveltecharts/core`.
 *
 * Nothing here imports Svelte, a chart library or a `.svelte` file, so it loads in plain Node,
 * in a test runner without the Svelte plugin and in a worker. Use it to prepare data (aggregate
 * ticks into candles, normalize price arrays and markers) without pulling a chart into the bundle.
 */
export { aggregateCandles } from './candleAggregation.js';
export type {
	AggregatedCandles,
	CandleInterval,
	PriceTicks,
	TickCandlesInput
} from './candleAggregation.js';
export { applyPriceData, priceSignature, resolvePriceData } from './priceInput.js';
export type {
	CandlesInput,
	CandlesSource,
	PriceLineInput,
	ResolvedPriceData
} from './priceInput.js';
export { groupMarkers, normalizeInjectedMarkers } from './injectedMarkers.js';
export type {
	InjectedMarker,
	InjectedMarkerKind,
	InjectedMarkerShape,
	MarkerGroup,
	NormalizedMarker
} from './injectedMarkers.js';
export { diffInjectedSeries, toSortedColumns } from './seriesInput.js';
export type { InjectedLineStyle, InjectedSeries, NumericArray } from './seriesInput.js';
export {
	formatPreciseValue,
	getPricePrecision,
	getSignificantPrecision,
	normalizeDecimals
} from './pricePrecision.js';
export type {
	ChartCapabilities,
	CrosshairMoveEvent,
	LegendItem,
	TimeRangeMs,
	TimeSeriesChartAdapter
} from './chartAdapter.js';
