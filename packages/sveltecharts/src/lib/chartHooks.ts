import type { ISeriesApi, MouseEventParams, SeriesType, Time } from 'lightweight-charts';
import type { MarkerHover } from './injectedMarkers';

/**
 * What the Lightweight Charts builder offers the chart component for its crosshair tooltip.
 * The builder registers itself against the chart instance it was created with, so the component
 * and the builder do not need to be wired together by hand.
 */
export type ChartHoverHooks = {
	/** Markers drawn on the bar under the crosshair, or `null` when there are none. */
	getMarkerHover(param: MouseEventParams<Time>): MarkerHover | null;
	/** Display string for a value of one of the builder's own series; `undefined` = use the default. */
	formatValue(series: ISeriesApi<SeriesType, Time>, value: number): string | undefined;
};

const registry = new WeakMap<object, ChartHoverHooks>();

export function registerChartHoverHooks(chart: object, hooks: ChartHoverHooks): void {
	registry.set(chart, hooks);
}

export function unregisterChartHoverHooks(chart: object): void {
	registry.delete(chart);
}

export function getChartHoverHooks(chart: object): ChartHoverHooks | undefined {
	return registry.get(chart);
}
