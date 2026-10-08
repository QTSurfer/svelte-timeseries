/**
 * ECharts option fragments for injected series, stacked panes and injected markers. Everything
 * here is pure (no chart instance), so the layout and the marker mapping are unit-testable.
 */
import { formatPreciseValue } from './pricePrecision';
import { escapeHtml, toHoverItems, type MarkerGroup, type MarkerPosition } from './injectedMarkers';
import type { InjectedLineStyle } from './seriesInput';

/** Ids of the series created for injected input (so they can be told apart from the rest). */
export const INJECTED_SERIES_PREFIX = 'inj:';
/** Ids of the helper series that carry the mark points of injected markers. */
export const MARKER_SERIES_PREFIX = 'inj-markers:';
/** Names of the mark point items created for injected markers. */
export const INJECTED_MARK_PREFIX = 'injected-marker-';

export const injectedSeriesId = (name: string) => `${INJECTED_SERIES_PREFIX}${name}`;

/** Vertical placement of a pane, in percent of the chart height. */
export type PaneGeometry = { top: number; height: number };

/** Vertical band the panes share: the legend sits above it and the zoom slider below. */
export const PANE_REGION = { top: 10, bottom: 15 } as const;
/** Space between panes, in percent of the chart height. */
export const PANE_GAP = 3;

/** Splits the pane region into stacked bands whose heights follow `ratios`. */
export function computePaneGeometry(ratios: readonly number[]): PaneGeometry[] {
	const usable = 100 - PANE_REGION.top - PANE_REGION.bottom - PANE_GAP * (ratios.length - 1);
	const total = ratios.reduce((sum, ratio) => sum + ratio, 0) || 1;

	let top: number = PANE_REGION.top;
	return ratios.map((ratio) => {
		const height = (usable * ratio) / total;
		const band = { top, height };
		top += height + PANE_GAP;
		return band;
	});
}

const round = (value: number) => Math.round(value * 100) / 100;

type Obj = Record<string, unknown>;

/**
 * Grid, x axes and extra y axes for `ratios.length` stacked panes. Pane 0 reuses the chart's
 * existing axes (`baseXAxis` / the first two `baseYAxis` entries); every other pane gets its own
 * grid, a time axis tied to the same range and a value axis. Only the lowest pane shows time labels.
 */
export function buildPaneLayout(
	ratios: readonly number[],
	baseGrid: Obj,
	baseXAxis: Obj,
	baseYAxis: readonly Obj[]
): { grid: Obj[]; xAxis: Obj[]; yAxis: Obj[] } {
	const geometry = computePaneGeometry(ratios);
	const last = ratios.length - 1;
	// Panes are placed by top and height; a leftover `bottom` would override the height.
	const gridWithoutBottom: Obj = { ...baseGrid };
	delete gridWithoutBottom.bottom;

	const grid = geometry.map((band, index) => ({
		...gridWithoutBottom,
		id: `pane-grid-${index}`,
		top: `${round(band.top)}%`,
		height: `${round(band.height)}%`
	}));

	const baseLabel = (baseXAxis.axisLabel ?? {}) as Obj;
	const xAxis = geometry.map((_, index) => {
		const axis: Obj = {
			...baseXAxis,
			id: `pane-x-${index}`,
			gridIndex: index,
			axisLabel: { ...baseLabel, show: index === last }
		};
		if (index > 0) {
			axis.axisLine = { show: true };
			axis.splitLine = { show: false };
		}
		return axis;
	});

	// The chart's own two value axes (price, percentage) stay in pane 0; every other pane
	// gets one more, in pane order.
	const yAxis = geometry.slice(1).map((_, offset) => ({
		id: `pane-y-${offset + 1}`,
		type: 'value',
		gridIndex: offset + 1,
		scale: true,
		splitLine: { show: false },
		axisLine: { show: true, lineStyle: { type: 'dashed' } },
		axisLabel: { formatter: formatPreciseValue }
	}));

	return { grid, xAxis, yAxis: [...baseYAxis, ...yAxis] };
}

export type InjectedLineOptions = {
	name: string;
	data: [number, number | null][];
	color: string;
	lineWidth: number;
	lineStyle: InjectedLineStyle;
	hasGaps: boolean;
	xAxisIndex: number;
	yAxisIndex: number;
};

export function buildInjectedLineSeries(options: InjectedLineOptions): Obj {
	return {
		type: 'line',
		id: injectedSeriesId(options.name),
		name: options.name,
		data: options.data,
		animation: false,
		showSymbol: false,
		silent: true,
		clip: true,
		connectNulls: false,
		smooth: false,
		// Min/max sampling keeps the shape of a sparse series; LTTB would bridge its gaps.
		sampling: options.hasGaps ? 'minmax' : 'lttb',
		progressive: 4000,
		progressiveThreshold: 3000,
		progressiveChunkMode: 'mod',
		emphasis: { focus: 'none', disabled: true },
		lineStyle: { width: options.lineWidth, type: options.lineStyle, color: options.color },
		itemStyle: { color: options.color },
		xAxisIndex: options.xAxisIndex,
		yAxisIndex: options.yAxisIndex
	};
}

const ARROW_UP = 'path://M12 1L2 13h7v10h6V13h7z';
const ARROW_DOWN = 'path://M12 23L2 11h7V1h6v10h7z';
export const MARKER_SYMBOL_SIZE = 14;

export function markerSymbol(shape: MarkerGroup['shape']): string {
	switch (shape) {
		case 'arrowUp':
			return ARROW_UP;
		case 'arrowDown':
			return ARROW_DOWN;
		case 'square':
			return 'rect';
		default:
			return 'circle';
	}
}

/**
 * Pixel offset from the anchor point, so the glyph sits where Lightweight Charts would draw it.
 * `stack` is the number of glyphs already drawn on that side of the same bar; each one pushes the
 * next further out, as Lightweight Charts does, so glyphs of different looks never overlap.
 */
export function markerOffset(
	position: MarkerPosition,
	size = MARKER_SYMBOL_SIZE,
	stack = 0
): [number, number] {
	const step = size + 2;
	switch (position) {
		case 'belowBar':
			return [0, size + stack * step];
		case 'aboveBar':
			return [0, -(size + stack * step)];
		case 'atPriceBottom':
			return [0, size / 2];
		case 'atPriceTop':
			return [0, -size / 2];
		default:
			return [0, 0];
	}
}

/** Tooltip body for a marker group (HTML, escaped: marker text comes from the host app). */
export function markerTooltipHtml(group: MarkerGroup): string {
	const { items, more } = toHoverItems([group]);
	const lines = items.map((item) => {
		const price = item.price === undefined ? '' : ` @ ${formatPreciseValue(item.price)}`;
		const text = item.text ? `<br/>${escapeHtml(item.text)}` : '';
		return (
			`<span style="color:${escapeHtml(item.color)}">&#9679;</span> ` +
			`<b>${escapeHtml(item.kindLabel)}</b>${price}${text}`
		);
	});
	if (more > 0) lines.push(`+${more} more`);
	return lines.join('<br/>');
}

export function buildMarkPointItem(group: MarkerGroup, index: number, y: number, stack = 0): Obj {
	const label = group.label
		? {
				show: true,
				formatter: group.label,
				position:
					group.position === 'belowBar' || group.position === 'atPriceBottom' ? 'bottom' : 'top',
				color: group.color,
				fontSize: 10,
				fontWeight: 'bold'
			}
		: { show: false };

	return {
		name: `${INJECTED_MARK_PREFIX}${index}`,
		coord: [group.timeMs, y],
		symbol: markerSymbol(group.shape),
		symbolSize: MARKER_SYMBOL_SIZE,
		symbolOffset: markerOffset(group.position, MARKER_SYMBOL_SIZE, stack),
		itemStyle: { color: group.color },
		label,
		// Read back on hover (custom fields survive in the event's `data`).
		tooltipHtml: markerTooltipHtml(group),
		z: 11
	};
}

/** Inline style of the overlay that shows marker texts on hover. */
export const MARKER_OVERLAY_STYLE =
	'position:absolute;display:none;z-index:10;pointer-events:none;max-width:260px;padding:6px 10px;' +
	'border:1px solid #cbd5e1;border-radius:6px;background:rgba(255,255,255,0.96);color:#0f172a;' +
	'font:12px/1.5 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.12);overflow-wrap:anywhere;';

/**
 * Index of the last element of `times` that is `<= time` (nearest bar at or before), or -1.
 * `times` must be ascending.
 */
export function lastIndexAtOrBefore(times: ArrayLike<number | null>, time: number): number {
	let low = 0;
	let high = times.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const value = times[middle];
		if (value !== null && value <= time) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return found;
}
