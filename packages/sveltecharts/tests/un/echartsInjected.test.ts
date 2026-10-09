import { describe, expect, it } from 'vitest';
import {
	INJECTED_MARK_PREFIX,
	MARKER_SYMBOL_SIZE,
	PANE_GAP,
	PANE_REGION,
	buildInjectedLineSeries,
	buildMarkPointItem,
	buildPaneLayout,
	computePaneGeometry,
	lastIndexAtOrBefore,
	markerOffset,
	markerSymbol,
	markerTooltipHtml
} from '../../src/lib/echartsInjected';
import { groupMarkers, normalizeInjectedMarkers } from '../../src/lib/injectedMarkers';

const groupsOf = (...markers: Parameters<typeof normalizeInjectedMarkers>[0]) =>
	groupMarkers(normalizeInjectedMarkers(markers).markers);

describe('computePaneGeometry', () => {
	it('fills the pane region, leaving the legend and slider space', () => {
		const [price, rsi] = computePaneGeometry([3, 1]);
		expect(price.top).toBe(PANE_REGION.top);
		expect(rsi.top).toBeCloseTo(price.top + price.height + PANE_GAP);
		expect(rsi.top + rsi.height).toBeCloseTo(100 - PANE_REGION.bottom);
	});

	it('splits the height by ratio', () => {
		const [a, b] = computePaneGeometry([3, 1]);
		expect(a.height / b.height).toBeCloseTo(3);
	});

	it('gives a single pane the whole region', () => {
		const [only] = computePaneGeometry([1]);
		expect(only).toEqual({ top: 10, height: 75 });
	});
});

describe('buildPaneLayout', () => {
	const baseGrid = { top: '10%', left: '3%', right: '4%', bottom: '15%', containLabel: true };
	const baseX = { type: 'time', axisLabel: { formatter: () => 'x' } };
	const baseY = [{ type: 'value' }, { type: 'value', name: '%' }];

	it('creates one grid per pane, positioned by top and height only', () => {
		const { grid } = buildPaneLayout([3, 1], baseGrid, baseX, baseY);
		expect(grid).toHaveLength(2);
		expect(grid.every((item) => !('bottom' in item))).toBe(true);
		expect(grid[1]).toMatchObject({ left: '3%', right: '4%', containLabel: true });
		expect(grid.map((item) => item.id)).toEqual(['pane-grid-0', 'pane-grid-1']);
	});

	it('ties every pane to its grid and shows time labels on the lowest pane only', () => {
		const { xAxis } = buildPaneLayout([3, 1, 1], baseGrid, baseX, baseY);
		expect(xAxis.map((axis) => axis.gridIndex)).toEqual([0, 1, 2]);
		expect(xAxis.map((axis) => (axis.axisLabel as { show: boolean }).show)).toEqual([
			false,
			false,
			true
		]);
		expect((xAxis[2].axisLabel as { formatter: unknown }).formatter).toBe(
			(baseX.axisLabel as { formatter: unknown }).formatter
		);
	});

	it('keeps the existing value axes in pane 0 and adds one per extra pane', () => {
		const { yAxis } = buildPaneLayout([3, 1, 1], baseGrid, baseX, baseY);
		expect(yAxis).toHaveLength(4);
		expect(yAxis.slice(0, 2)).toEqual(baseY);
		expect(yAxis.slice(2).map((axis) => axis.gridIndex)).toEqual([1, 2]);
	});
});

describe('buildInjectedLineSeries', () => {
	const options = {
		name: 'EMA',
		data: [[1000, 1]] as [number, number | null][],
		color: '#f59e0b',
		lineWidth: 2,
		lineStyle: 'dashed' as const,
		hasGaps: false,
		xAxisIndex: 1,
		yAxisIndex: 2
	};

	it('creates a silent line series bound to its pane axes', () => {
		expect(buildInjectedLineSeries(options)).toMatchObject({
			type: 'line',
			id: 'inj:EMA',
			name: 'EMA',
			silent: true,
			xAxisIndex: 1,
			yAxisIndex: 2,
			lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
			itemStyle: { color: '#f59e0b' },
			connectNulls: false
		});
	});

	it('samples with min/max when the series has gaps and LTTB otherwise', () => {
		expect(buildInjectedLineSeries(options).sampling).toBe('lttb');
		expect(buildInjectedLineSeries({ ...options, hasGaps: true }).sampling).toBe('minmax');
	});
});

describe('marker mapping', () => {
	it('maps shapes to symbols', () => {
		expect(markerSymbol('circle')).toBe('circle');
		expect(markerSymbol('square')).toBe('rect');
		expect(markerSymbol('arrowUp')).toMatch(/^path:\/\//);
		expect(markerSymbol('arrowDown')).not.toBe(markerSymbol('arrowUp'));
	});

	it('offsets the glyph above or below its anchor and stacks further glyphs outwards', () => {
		const size = MARKER_SYMBOL_SIZE;
		expect(markerOffset('belowBar')).toEqual([0, size]);
		expect(markerOffset('aboveBar')).toEqual([0, -size]);
		expect(markerOffset('aboveBar', size, 1)).toEqual([0, -(2 * size + 2)]);
		expect(markerOffset('belowBar', size, 2)).toEqual([0, 3 * size + 4]);
		expect(markerOffset('atPriceMiddle')).toEqual([0, 0]);
	});

	it('builds a mark point at the group time and height with a count label when merged', () => {
		const [group] = groupsOf(
			{ time: 1000, kind: 'buy', text: 'a' },
			{ time: 1400, kind: 'buy', text: 'b' }
		);
		const item = buildMarkPointItem(group, 3, 101.5);
		expect(item).toMatchObject({
			name: `${INJECTED_MARK_PREFIX}3`,
			coord: [1000, 101.5],
			label: { show: true, formatter: '×2' }
		});
		expect(String(item.tooltipHtml)).toContain('a');
		expect(String(item.tooltipHtml)).toContain('b');
	});

	it('draws no label for a lone injected marker', () => {
		const [group] = groupsOf({ time: 1000, kind: 'sell' });
		expect(buildMarkPointItem(group, 0, 1).label).toEqual({ show: false });
	});

	it('escapes marker text in the tooltip HTML', () => {
		const [group] = groupsOf({ time: 1000, kind: 'info', text: '<script>alert(1)</script>' });
		const html = markerTooltipHtml(group);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('shows the anchor price in the tooltip', () => {
		const [group] = groupsOf({ time: 1000, kind: 'buy', price: 123.45 });
		expect(markerTooltipHtml(group)).toContain('@ 123.45');
	});
});

describe('lastIndexAtOrBefore', () => {
	const times = [10, 20, 30, 40];

	it('finds the bar at or before a time', () => {
		expect(lastIndexAtOrBefore(times, 25)).toBe(1);
		expect(lastIndexAtOrBefore(times, 30)).toBe(2);
		expect(lastIndexAtOrBefore(times, 99)).toBe(3);
	});

	it('returns -1 before the first bar and for no data', () => {
		expect(lastIndexAtOrBefore(times, 5)).toBe(-1);
		expect(lastIndexAtOrBefore([], 5)).toBe(-1);
	});
});
