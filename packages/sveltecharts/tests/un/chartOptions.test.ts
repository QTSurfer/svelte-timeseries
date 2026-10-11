import { describe, expect, it } from 'vitest';
import { mergeChartOptions } from '../../src/lib/chartOptions';

const defaults = {
	layout: { background: { color: '#fff' }, textColor: '#000' },
	grid: { vertLines: { color: 'a' }, horzLines: { color: 'b' } },
	timeScale: { timeVisible: true, borderColor: 'c' }
};

describe('mergeChartOptions', () => {
	it('returns the defaults when the app passes nothing', () => {
		expect(mergeChartOptions(defaults, undefined)).toBe(defaults);
		expect(mergeChartOptions(defaults, {})).toEqual(defaults);
	});

	it('changes the background and keeps the text color of the defaults', () => {
		const merged = mergeChartOptions(defaults, { layout: { background: { color: '#111' } } });
		expect(merged.layout).toEqual({ background: { color: '#111' }, textColor: '#000' });
	});

	it('merges deeper levels and adds options the defaults do not have', () => {
		const merged = mergeChartOptions(defaults, {
			grid: { vertLines: { visible: false } },
			rightPriceScale: { borderVisible: false }
		}) as Record<string, unknown>;
		expect(merged.grid).toEqual({
			vertLines: { color: 'a', visible: false },
			horzLines: { color: 'b' }
		});
		expect(merged.rightPriceScale).toEqual({ borderVisible: false });
	});

	it('ignores undefined values and does not change its inputs', () => {
		const extra = { layout: { textColor: undefined, fontSize: 14 } };
		const merged = mergeChartOptions(defaults, extra);
		expect(merged.layout).toMatchObject({ textColor: '#000', fontSize: 14 });
		expect(defaults.layout).toEqual({ background: { color: '#fff' }, textColor: '#000' });
	});

	it('replaces arrays instead of merging them', () => {
		const merged = mergeChartOptions({ list: [1, 2, 3] }, { list: [9] });
		expect(merged.list).toEqual([9]);
	});

	it('never lets the app turn the attribution logo off', () => {
		const merged = mergeChartOptions(
			{ layout: { attributionLogo: true, textColor: '#000' } },
			{ layout: { attributionLogo: false, textColor: '#fff' } }
		);
		expect(merged.layout).toEqual({ attributionLogo: true, textColor: '#fff' });
		const alone = mergeChartOptions({}, { layout: { attributionLogo: false } }) as {
			layout: object;
		};
		expect(alone.layout).toEqual({});
	});
});
