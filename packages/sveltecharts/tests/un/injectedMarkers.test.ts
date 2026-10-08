import { describe, expect, it } from 'vitest';
import {
	MARKER_KIND_STYLE,
	escapeHtml,
	findGroupsInSpan,
	groupMarkers,
	normalizeInjectedMarkers,
	toHoverItems,
	type InjectedMarker,
	type NormalizedMarker
} from '../../src/lib/injectedMarkers';

const normalize = (...markers: InjectedMarker[]) => normalizeInjectedMarkers(markers).markers;

describe('normalizeInjectedMarkers', () => {
	it('draws a buy as a green arrow up below the bar', () => {
		const [marker] = normalize({ time: 5400, kind: 'buy' });
		expect(marker).toMatchObject({
			second: 5,
			position: 'belowBar',
			shape: 'arrowUp',
			color: MARKER_KIND_STYLE.buy.color
		});
	});

	it('draws a sell as a red arrow down above the bar', () => {
		const [marker] = normalize({ time: 1000, kind: 'sell' });
		expect(marker).toMatchObject({ position: 'aboveBar', shape: 'arrowDown' });
		expect(marker.color).toBe(MARKER_KIND_STYLE.sell.color);
	});

	it('draws info as a neutral circle', () => {
		const [marker] = normalize({ time: 1000, kind: 'info' });
		expect(marker).toMatchObject({ shape: 'circle', color: MARKER_KIND_STYLE.info.color });
	});

	it('anchors a marker with a price at that price, on the matching side', () => {
		const markers = normalize(
			{ time: 1000, kind: 'buy', price: 99 },
			{ time: 1000, kind: 'sell', price: 101 },
			{ time: 1000, kind: 'info', price: 100 }
		);
		expect(markers.map((marker) => marker.position)).toEqual([
			'atPriceBottom',
			'atPriceTop',
			'atPriceMiddle'
		]);
		expect(markers.map((marker) => marker.price)).toEqual([99, 101, 100]);
	});

	it('lets color and shape override the defaults and ignores an unknown shape', () => {
		const [custom, unknown] = normalize(
			{ time: 1000, kind: 'buy', color: '#123456', shape: 'square' },
			{ time: 1000, kind: 'buy', shape: 'star' as never }
		);
		expect(custom).toMatchObject({ color: '#123456', shape: 'square' });
		expect(unknown.shape).toBe('arrowUp');
	});

	it('keeps the text and the series name', () => {
		const [marker] = normalize({ time: 1000, kind: 'info', text: 'hello', series: 'RSI' });
		expect(marker).toMatchObject({ text: 'hello', series: 'RSI' });
	});

	it('truncates very long texts', () => {
		const [marker] = normalize({ time: 1000, kind: 'info', text: 'x'.repeat(2000) });
		expect(marker.text).toHaveLength(500);
	});

	it('skips markers without a finite time and draws unknown kinds as info, reporting both', () => {
		const { markers, issues } = normalizeInjectedMarkers([
			{ time: Number.NaN, kind: 'buy' },
			{ time: '5' as never, kind: 'buy' },
			{ time: 1000, kind: 'weird' as never }
		]);
		expect(markers).toHaveLength(1);
		expect(markers[0].kind).toBe('info');
		expect(issues).toHaveLength(2);
	});
});

function marker(overrides: Partial<NormalizedMarker> & Pick<NormalizedMarker, 'second'>) {
	return {
		timeMs: overrides.second * 1000,
		kind: 'buy',
		kindLabel: 'Buy',
		position: 'belowBar',
		shape: 'arrowUp',
		color: '#16a34a',
		...overrides
	} as NormalizedMarker;
}

describe('groupMarkers', () => {
	it('merges markers with an identical look in the same second into one counted glyph', () => {
		const groups = groupMarkers(
			normalize(
				{ time: 5100, kind: 'buy', text: 'first' },
				{ time: 5450, kind: 'buy', text: 'second' },
				{ time: 5900, kind: 'buy', text: 'third' }
			)
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].label).toBe('×3');
		expect(groups[0].entries.map((entry) => entry.text)).toEqual(['first', 'second', 'third']);
		expect(groups[0].timeMs).toBe(5100);
	});

	it('keeps different looks in the same second as separate glyphs', () => {
		const groups = groupMarkers(
			normalize(
				{ time: 5100, kind: 'buy' },
				{ time: 5200, kind: 'sell' },
				{ time: 5300, kind: 'info' },
				{ time: 5400, kind: 'buy', color: 'blue' }
			)
		);
		expect(groups).toHaveLength(4);
		expect(groups.every((group) => group.entries.length === 1)).toBe(true);
	});

	it('does not merge markers anchored at different prices', () => {
		const groups = groupMarkers(
			normalize(
				{ time: 1000, kind: 'buy', price: 10 },
				{ time: 1100, kind: 'buy', price: 11 },
				{ time: 1200, kind: 'buy', price: 10 }
			)
		);
		expect(groups).toHaveLength(2);
		expect(groups[0].entries).toHaveLength(2);
	});

	it('does not merge markers from different seconds', () => {
		const groups = groupMarkers(
			normalize({ time: 1999, kind: 'buy' }, { time: 2000, kind: 'buy' })
		);
		expect(groups.map((group) => group.second)).toEqual([1, 2]);
	});

	it('sorts by time as the chart requires and keeps input order inside a second', () => {
		const groups = groupMarkers(
			normalize(
				{ time: 9000, kind: 'sell' },
				{ time: 3000, kind: 'info' },
				{ time: 3000, kind: 'buy' }
			)
		);
		expect(groups.map((group) => [group.second, group.entries[0].kindLabel])).toEqual([
			[3, 'Info'],
			[3, 'Buy'],
			[9, 'Sell']
		]);
	});

	it('draws the chart text of a lone marker and a count for a merged one', () => {
		const lone = groupMarkers([marker({ second: 1, chartText: 'market' })]);
		expect(lone[0].label).toBe('market');
		const merged = groupMarkers([
			marker({ second: 1, chartText: 'market' }),
			marker({ second: 1, chartText: 'market' })
		]);
		expect(merged[0].label).toBe('×2');
	});

	it('draws no text for injected markers unless merged', () => {
		const [group] = groupMarkers(normalize({ time: 1000, kind: 'buy', text: 'long note' }));
		expect(group.label).toBeUndefined();
	});

	it('handles no markers', () => {
		expect(groupMarkers([])).toEqual([]);
	});
});

describe('findGroupsInSpan', () => {
	const groups = groupMarkers(
		[1, 3, 3, 5, 8].map((second, index) =>
			marker({ second, color: index === 2 ? 'blue' : '#16a34a' })
		)
	);

	it('returns the groups from the start of the span up to, not including, its end', () => {
		expect(findGroupsInSpan(groups, 3, 8).map((group) => group.second)).toEqual([3, 3, 5]);
	});

	it('finds a marker that sits after the bar start but before the next bar', () => {
		expect(findGroupsInSpan(groups, 4, 6).map((group) => group.second)).toEqual([5]);
	});

	it('supports an open-ended span for the last bar', () => {
		expect(findGroupsInSpan(groups, 5, Number.POSITIVE_INFINITY).map((g) => g.second)).toEqual([
			5, 8
		]);
	});

	it('returns nothing outside the markers or for no markers', () => {
		expect(findGroupsInSpan(groups, 9, 20)).toEqual([]);
		expect(findGroupsInSpan(groups, 0, 1)).toEqual([]);
		expect(findGroupsInSpan([], 0, 10)).toEqual([]);
	});

	it('stays correct on a large sorted list', () => {
		const many = groupMarkers(
			Array.from({ length: 50_000 }, (_, index) => marker({ second: index * 2 }))
		);
		expect(findGroupsInSpan(many, 40_000, 40_007).map((group) => group.second)).toEqual([
			40_000, 40_002, 40_004, 40_006
		]);
	});
});

describe('toHoverItems', () => {
	it('lists every marker of every group with the color of its glyph', () => {
		const groups = groupMarkers(
			normalize(
				{ time: 1000, kind: 'buy', text: 'a' },
				{ time: 1100, kind: 'buy', text: 'b' },
				{ time: 1200, kind: 'sell', text: 'c' }
			)
		);
		const { items, more } = toHoverItems(groups);
		expect(items.map((item) => [item.kindLabel, item.text])).toEqual([
			['Buy', 'a'],
			['Buy', 'b'],
			['Sell', 'c']
		]);
		expect(items[0].color).toBe(MARKER_KIND_STYLE.buy.color);
		expect(more).toBe(0);
	});

	it('caps the list and counts the rest', () => {
		const groups = groupMarkers(
			Array.from({ length: 12 }, (_, i) => marker({ second: 1, timeMs: 1000 + i }))
		);
		const { items, more } = toHoverItems(groups, 5);
		expect(items).toHaveLength(5);
		expect(more).toBe(7);
	});
});

describe('escapeHtml', () => {
	it('escapes markup so marker text cannot inject HTML', () => {
		expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
			'&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
		);
	});
});
