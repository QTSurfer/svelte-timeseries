import { describe, expect, it } from 'vitest';
import {
	defaultInjectedColor,
	diffInjectedSeries,
	hasGaps,
	lineStyleToLightweight,
	lineWidthToLightweight,
	normalizePane,
	resolvePaneIndexes,
	resolvePaneRatios,
	snapshotInjectedSeries,
	toEChartsLineData,
	toLightweightLineData,
	toSortedColumns,
	type InjectedSeries,
	type InjectedSeriesSnapshot
} from '../../src/lib/seriesInput';

describe('toSortedColumns', () => {
	it('reads plain arrays', () => {
		const { times, values } = toSortedColumns([1000, 2000, 3000], [10, 20, 30]);
		expect([...times]).toEqual([1000, 2000, 3000]);
		expect([...values]).toEqual([10, 20, 30]);
	});

	it('reads typed arrays without copying them into plain arrays first', () => {
		const { times, values } = toSortedColumns(
			new Float64Array([1000, 2000]),
			new Float32Array([1.5, 2.5])
		);
		expect([...times]).toEqual([1000, 2000]);
		expect([...values]).toEqual([1.5, 2.5]);
	});

	it('turns null, undefined, NaN and infinite values into gaps', () => {
		const { values } = toSortedColumns(
			[1, 2, 3, 4, 5],
			[null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 7]
		);
		expect([...values].map((value) => (Number.isNaN(value) ? 'gap' : value))).toEqual([
			'gap',
			'gap',
			'gap',
			'gap',
			7
		]);
	});

	it('drops points whose time is not a finite number', () => {
		const { times, values } = toSortedColumns(
			[1000, null, Number.NaN, 4000, undefined],
			[1, 2, 3, 4, 5]
		);
		expect([...times]).toEqual([1000, 4000]);
		expect([...values]).toEqual([1, 4]);
	});

	it('sorts unsorted input by time and keeps input order for equal times', () => {
		const { times, values } = toSortedColumns([3000, 1000, 2000, 1000], [30, 10, 20, 11]);
		expect([...times]).toEqual([1000, 1000, 2000, 3000]);
		expect([...values]).toEqual([10, 11, 20, 30]);
	});

	it('uses the common prefix when the arrays differ in length', () => {
		const { times, values } = toSortedColumns([1000, 2000, 3000], [1, 2]);
		expect(times.length).toBe(2);
		expect(values.length).toBe(2);
	});

	it('handles empty input', () => {
		const { times, values } = toSortedColumns([], []);
		expect(times.length).toBe(0);
		expect(values.length).toBe(0);
	});
});

describe('line data conversion', () => {
	it('converts milliseconds to chart seconds and renders gaps as whitespace points', () => {
		const columns = toSortedColumns([1000, 2000, 3000], [null, 5, 6]);
		expect(toLightweightLineData(columns)).toEqual([
			{ time: 1 },
			{ time: 2, value: 5 },
			{ time: 3, value: 6 }
		]);
	});

	it('collapses points that share a chart second, keeping the first', () => {
		const columns = toSortedColumns([1000, 1400, 1999, 2000], [1, 2, 3, 4]);
		expect(toLightweightLineData(columns)).toEqual([
			{ time: 1, value: 1 },
			{ time: 2, value: 4 }
		]);
	});

	it('keeps milliseconds and nulls for ECharts', () => {
		const columns = toSortedColumns([1000, 1400], [null, 2]);
		expect(toEChartsLineData(columns)).toEqual([
			[1000, null],
			[1400, 2]
		]);
	});

	it('reports whether a series has gaps', () => {
		expect(hasGaps(toSortedColumns([1, 2], [1, 2]))).toBe(false);
		expect(hasGaps(toSortedColumns([1, 2], [1, null]))).toBe(true);
	});
});

describe('line options', () => {
	it('maps line styles to the Lightweight Charts enum values', () => {
		expect(lineStyleToLightweight('solid')).toBe(0);
		expect(lineStyleToLightweight('dotted')).toBe(1);
		expect(lineStyleToLightweight('dashed')).toBe(2);
		expect(lineStyleToLightweight(undefined)).toBe(0);
	});

	it('clamps line widths to the integers Lightweight Charts draws', () => {
		expect(lineWidthToLightweight(undefined)).toBe(1);
		expect(lineWidthToLightweight(0.2)).toBe(1);
		expect(lineWidthToLightweight(2.4)).toBe(2);
		expect(lineWidthToLightweight(9)).toBe(4);
		expect(lineWidthToLightweight(Number.NaN)).toBe(1);
	});

	it('normalizes pane numbers', () => {
		expect(normalizePane(undefined)).toBe(0);
		expect(normalizePane(-2)).toBe(0);
		expect(normalizePane(Number.NaN)).toBe(0);
		expect(normalizePane(2.9)).toBe(2);
	});

	it('cycles the default colors', () => {
		expect(defaultInjectedColor(0)).toBe(defaultInjectedColor(6));
		expect(defaultInjectedColor(0)).not.toBe(defaultInjectedColor(1));
	});
});

describe('diffInjectedSeries', () => {
	const times = [1000, 2000];
	const values = [1, 2];
	const ema: InjectedSeries = { name: 'EMA', times, values };
	const applied = (...series: InjectedSeries[]) =>
		new Map<string, InjectedSeriesSnapshot>(
			series.map((item) => [item.name, snapshotInjectedSeries(item)])
		);

	it('adds series that are new', () => {
		const diff = diffInjectedSeries(applied(), [ema]);
		expect(diff.added).toEqual([ema]);
		expect(diff.removed).toEqual([]);
		expect(diff.changed).toEqual([]);
	});

	it('removes series that are no longer requested', () => {
		const diff = diffInjectedSeries(applied(ema), []);
		expect(diff.removed).toEqual(['EMA']);
	});

	it('reports nothing for an identical request', () => {
		const diff = diffInjectedSeries(applied(ema), [{ ...ema }]);
		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.changed).toEqual([]);
	});

	it('flags only the data when the arrays are replaced', () => {
		const [change] = diffInjectedSeries(applied(ema), [{ ...ema, values: [1, 2] }]).changed;
		expect(change).toMatchObject({ data: true, style: false, pane: false, visible: false });
	});

	it('flags the data when an array grows in place', () => {
		const growing = { name: 'G', times: [1000], values: [1] };
		const snapshot = applied(growing);
		growing.times.push(2000);
		growing.values.push(2);
		const [change] = diffInjectedSeries(snapshot, [growing]).changed;
		expect(change.data).toBe(true);
	});

	it('does not touch the data for style, pane and visibility changes', () => {
		const [change] = diffInjectedSeries(applied(ema), [
			{ ...ema, color: 'red', lineWidth: 3, lineStyle: 'dashed', pane: 2, visible: false }
		]).changed;
		expect(change).toMatchObject({ data: false, style: true, pane: true, visible: true });
	});

	it('skips unnamed, duplicate and malformed series and says why', () => {
		const diff = diffInjectedSeries(applied(), [
			{ name: '', times, values },
			ema,
			{ ...ema, color: 'red' },
			{ name: 'bad', times: undefined, values } as unknown as InjectedSeries
		]);
		expect(diff.valid).toEqual([ema]);
		expect(diff.issues).toHaveLength(3);
	});

	it('warns about length mismatches but still draws the common prefix', () => {
		const diff = diffInjectedSeries(applied(), [{ name: 'M', times: [1, 2, 3], values: [1] }]);
		expect(diff.valid).toHaveLength(1);
		expect(diff.issues[0]).toContain('3 times but 1 values');
	});
});

describe('panes', () => {
	it('keeps the price pane at index 0 and orders the other panes by number', () => {
		const requested = new Map([
			['a', 0],
			['b', 7],
			['c', 3]
		]);
		const indexes = resolvePaneIndexes(requested, true);
		expect(indexes.get('a')).toBe(0);
		expect(indexes.get('c')).toBe(1);
		expect(indexes.get('b')).toBe(2);
	});

	it('reserves pane 0 for the price series even when no injected series uses it', () => {
		const indexes = resolvePaneIndexes(new Map([['rsi', 1]]), true);
		expect(indexes.get('rsi')).toBe(1);
	});

	it('uses the first requested pane as index 0 when there is no price series', () => {
		const indexes = resolvePaneIndexes(new Map([['rsi', 1]]), false);
		expect(indexes.get('rsi')).toBe(0);
	});

	it('defaults pane heights to 3 for the price pane and 1 for the others', () => {
		expect(resolvePaneRatios(undefined, [1, 2], true)).toEqual([3, 1, 1]);
	});

	it('applies configured heights by pane number and ignores invalid ones', () => {
		expect(resolvePaneRatios({ 0: 2, 1: 2, 4: -1 }, [1, 4], true)).toEqual([2, 2, 1]);
	});
});
