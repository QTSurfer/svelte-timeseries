/**
 * Pure helpers that turn arrays supplied by the host app into the columnar form the chart
 * builders consume. Nothing here touches a chart instance, so everything is unit-testable.
 *
 * Time unit: every `times` array in this library is **epoch milliseconds** (the same unit the
 * DuckDB pipeline normalizes to and the builders convert to chart seconds internally).
 */
import type { UTCTimestamp } from 'lightweight-charts';

/**
 * A column of numbers read from the host app. Plain arrays, typed arrays (`Float64Array`, ...)
 * and arrays holding `null` / `undefined` / `NaN` (treated as gaps) are all accepted.
 */
export type NumericArray = ArrayLike<number | null | undefined>;

export type InjectedLineStyle = 'solid' | 'dashed' | 'dotted';

/**
 * A named line series computed by the host app (for example an indicator) and handed to the
 * chart as arrays. `times` and `values` are parallel; `null` / `NaN` values are gaps.
 */
export type InjectedSeries = {
	/** Unique name. Used as the series title, as the update key and by `InjectedMarker.series`. */
	name: string;
	/** Epoch milliseconds, ascending (unsorted input is sorted for you). */
	times: NumericArray;
	/** One value per time. `null` (or `NaN`) leaves a gap, e.g. while an indicator warms up. */
	values: NumericArray;
	/** Any CSS color. A stable default is picked when omitted. */
	color?: string;
	/** Line width in pixels (Lightweight Charts draws integers from 1 to 4). Default `1`. */
	lineWidth?: number;
	/** Default `'solid'`. */
	lineStyle?: InjectedLineStyle;
	/**
	 * Pane the series is drawn in. `0` (default) is the price pane; any other number gets its own
	 * pane with its own price scale, ordered by number (`1` above `2`...). Gaps collapse, so panes
	 * `0, 3, 7` render as three consecutive panes.
	 */
	pane?: number;
	/** Default `true`. */
	visible?: boolean;
};

/** Parallel time/value columns: ascending times, `NaN` marking gaps. */
export type ColumnarSeries = {
	times: Float64Array;
	values: Float64Array;
};

/**
 * Reads two parallel arrays into compact typed columns.
 *
 * - Points whose time is not a finite number are dropped.
 * - Values that are not finite numbers become `NaN` (a gap).
 * - Unsorted input is sorted by time (stable, so equal times keep their input order).
 * - When the arrays differ in length only the common prefix is used.
 */
export function toSortedColumns(times: NumericArray, values: NumericArray): ColumnarSeries {
	const n = Math.min(times.length, values.length);
	let t = new Float64Array(n);
	let v = new Float64Array(n);
	let count = 0;
	let sorted = true;
	let previous = -Infinity;

	for (let i = 0; i < n; i++) {
		const time = times[i];
		if (typeof time !== 'number' || !Number.isFinite(time)) continue;
		const value = values[i];
		t[count] = time;
		v[count] = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
		if (time < previous) sorted = false;
		previous = time;
		count++;
	}

	if (count < n) {
		t = t.slice(0, count);
		v = v.slice(0, count);
	}

	if (!sorted) {
		const order = new Uint32Array(count);
		for (let i = 0; i < count; i++) order[i] = i;
		order.sort((a, b) => t[a] - t[b] || a - b);
		const sortedTimes = new Float64Array(count);
		const sortedValues = new Float64Array(count);
		for (let i = 0; i < count; i++) {
			sortedTimes[i] = t[order[i]];
			sortedValues[i] = v[order[i]];
		}
		t = sortedTimes;
		v = sortedValues;
	}

	return { times: t, values: v };
}

/** Lightweight Charts line data: `{ time }` alone is a whitespace point (a gap). */
export type LightweightLinePoint = { time: UTCTimestamp; value?: number };

/**
 * Converts columns to Lightweight Charts data. Chart time is whole UTC seconds, so points that
 * fall in the same second collapse to the first one (the same rule the primary dataset uses).
 */
export function toLightweightLineData(columns: ColumnarSeries): LightweightLinePoint[] {
	const { times, values } = columns;
	const result: LightweightLinePoint[] = [];
	let previousSecond = Number.NaN;

	for (let i = 0; i < times.length; i++) {
		const second = Math.floor(times[i] / 1000);
		if (second === previousSecond) continue;
		previousSecond = second;
		const time = second as UTCTimestamp;
		const value = values[i];
		result.push(Number.isNaN(value) ? { time } : { time, value });
	}

	return result;
}

/** ECharts line data on a time axis (milliseconds); gaps are `null`. */
export function toEChartsLineData(columns: ColumnarSeries): [number, number | null][] {
	const { times, values } = columns;
	const result: [number, number | null][] = new Array(times.length);
	for (let i = 0; i < times.length; i++) {
		const value = values[i];
		result[i] = [times[i], Number.isNaN(value) ? null : value];
	}
	return result;
}

/** True when at least one value is a gap. */
export function hasGaps(columns: ColumnarSeries): boolean {
	for (let i = 0; i < columns.values.length; i++) {
		if (Number.isNaN(columns.values[i])) return true;
	}
	return false;
}

/** Lightweight Charts `LineStyle` enum values (Solid = 0, Dotted = 1, Dashed = 2). */
export function lineStyleToLightweight(style: InjectedLineStyle | undefined): 0 | 1 | 2 {
	if (style === 'dashed') return 2;
	if (style === 'dotted') return 1;
	return 0;
}

/** Lightweight Charts only draws integer line widths from 1 to 4. */
export function lineWidthToLightweight(width: number | undefined): 1 | 2 | 3 | 4 {
	if (width === undefined || !Number.isFinite(width)) return 1;
	return Math.min(4, Math.max(1, Math.round(width))) as 1 | 2 | 3 | 4;
}

/** What a series needs to be (re)drawn, captured when it is applied. */
export type InjectedSeriesSnapshot = {
	times: NumericArray;
	values: NumericArray;
	timesLength: number;
	valuesLength: number;
	color: string | undefined;
	lineWidth: number | undefined;
	lineStyle: InjectedLineStyle;
	pane: number;
	visible: boolean;
};

export function snapshotInjectedSeries(series: InjectedSeries): InjectedSeriesSnapshot {
	return {
		times: series.times,
		values: series.values,
		timesLength: series.times.length,
		valuesLength: series.values.length,
		color: series.color,
		lineWidth: series.lineWidth,
		lineStyle: series.lineStyle ?? 'solid',
		pane: normalizePane(series.pane),
		visible: series.visible ?? true
	};
}

export function normalizePane(pane: number | undefined): number {
	if (pane === undefined || !Number.isFinite(pane) || pane < 0) return 0;
	return Math.floor(pane);
}

export type InjectedSeriesChange = {
	series: InjectedSeries;
	/** Source arrays were replaced or resized: points must be rebuilt. */
	data: boolean;
	/** Color, width or line style changed. */
	style: boolean;
	pane: boolean;
	visible: boolean;
};

export type InjectedSeriesDiff = {
	/** Series to keep, in input order (invalid and duplicate entries removed). */
	valid: InjectedSeries[];
	removed: string[];
	added: InjectedSeries[];
	changed: InjectedSeriesChange[];
	/** Human-readable reasons for entries that were skipped. */
	issues: string[];
};

/**
 * Compares the requested series with what is already applied, by name. Source arrays are compared
 * by identity and length (no per-value scan), so an update that only touches style or visibility
 * never re-reads the data. Treat arrays as immutable: pass new arrays to change values.
 */
export function diffInjectedSeries(
	applied: ReadonlyMap<string, InjectedSeriesSnapshot>,
	requested: readonly InjectedSeries[]
): InjectedSeriesDiff {
	const issues: string[] = [];
	const valid: InjectedSeries[] = [];
	const seen = new Set<string>();

	for (const series of requested) {
		if (!series || typeof series.name !== 'string' || series.name.length === 0) {
			issues.push('An injected series without a name was skipped.');
			continue;
		}
		if (seen.has(series.name)) {
			issues.push(`Injected series "${series.name}" is declared more than once; the first wins.`);
			continue;
		}
		if (!isArrayLike(series.times) || !isArrayLike(series.values)) {
			issues.push(`Injected series "${series.name}" needs array-like "times" and "values".`);
			continue;
		}
		if (series.times.length !== series.values.length) {
			issues.push(
				`Injected series "${series.name}" has ${series.times.length} times but ${series.values.length} values; only the common prefix is drawn.`
			);
		}
		seen.add(series.name);
		valid.push(series);
	}

	const added: InjectedSeries[] = [];
	const changed: InjectedSeriesChange[] = [];

	for (const series of valid) {
		const previous = applied.get(series.name);
		if (!previous) {
			added.push(series);
			continue;
		}
		const next = snapshotInjectedSeries(series);
		const change: InjectedSeriesChange = {
			series,
			data:
				previous.times !== next.times ||
				previous.values !== next.values ||
				previous.timesLength !== next.timesLength ||
				previous.valuesLength !== next.valuesLength,
			style:
				previous.color !== next.color ||
				previous.lineWidth !== next.lineWidth ||
				previous.lineStyle !== next.lineStyle,
			pane: previous.pane !== next.pane,
			visible: previous.visible !== next.visible
		};
		if (change.data || change.style || change.pane || change.visible) changed.push(change);
	}

	const removed = [...applied.keys()].filter((name) => !seen.has(name));
	return { valid, removed, added, changed, issues };
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
	return value != null && typeof (value as ArrayLike<unknown>).length === 'number';
}

/**
 * Maps the pane numbers requested by the app to consecutive chart pane indexes.
 *
 * Index 0 is the price pane and exists whenever there is a price series (`hasPricePane`) or an
 * injected series asks for pane 0. Remaining numbers keep their relative order, so gaps collapse
 * (`0, 3, 7` become `0, 1, 2`).
 */
export function resolvePaneIndexes(
	requested: ReadonlyMap<string, number>,
	hasPricePane: boolean
): Map<string, number> {
	const occupied = new Set<number>(requested.values());
	if (hasPricePane) occupied.add(0);
	const ordered = [...occupied].sort((a, b) => a - b);
	const rank = new Map(ordered.map((pane, index) => [pane, index]));
	const result = new Map<string, number>();
	for (const [name, pane] of requested) result.set(name, rank.get(pane) ?? 0);
	return result;
}

/** Pane numbers (as requested by the app) to dense chart indexes, for `paneHeights`. */
export function resolvePaneRatios(
	paneHeights: Readonly<Record<number, number>> | undefined,
	requestedPanes: Iterable<number>,
	hasPricePane: boolean
): number[] {
	const occupied = new Set<number>(requestedPanes);
	if (hasPricePane) occupied.add(0);
	const ordered = [...occupied].sort((a, b) => a - b);
	return ordered.map((pane) => {
		const configured = paneHeights?.[pane];
		if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
			return configured;
		}
		return pane === 0 ? DEFAULT_PRICE_PANE_RATIO : 1;
	});
}

/** Relative height of the price pane when `paneHeights` does not set it (other panes: 1). */
export const DEFAULT_PRICE_PANE_RATIO = 3;

const INJECTED_PALETTE = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#ef4444'];

/** Default color for the nth injected series that did not specify one. */
export function defaultInjectedColor(index: number): string {
	return INJECTED_PALETTE[index % INJECTED_PALETTE.length];
}
