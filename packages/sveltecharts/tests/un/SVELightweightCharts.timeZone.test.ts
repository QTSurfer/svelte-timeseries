// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Harness from './support/TimeZoneHarness.svelte';

type FakeChart = {
	options: Record<string, any>;
	removed: boolean;
	applied: Record<string, any>[];
};

// The engine needs a canvas, which jsdom does not have: the component only needs something that takes
// its options and says when it is removed.
const fake = vi.hoisted(() => ({ charts: [] as FakeChart[] }));

vi.mock('lightweight-charts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('lightweight-charts')>();
	return {
		...actual,
		createChart: (_element: HTMLElement, options: Record<string, any>) => {
			const chart: FakeChart & Record<string, unknown> = {
				options,
				removed: false,
				applied: [],
				applyOptions: (next: Record<string, any>) => chart.applied.push(next),
				subscribeCrosshairMove: () => {},
				unsubscribeCrosshairMove: () => {},
				remove: () => {
					chart.removed = true;
				}
			};
			fake.charts.push(chart);
			return chart;
		}
	};
});

let mounted: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	fake.charts.length = 0;
});

const mountChart = () => {
	const onLoad = vi.fn(async () => {});
	const target = document.body.appendChild(document.createElement('div'));
	const instance = mount(Harness, { target, props: { onLoad } }) as {
		setZone: (z: string) => void;
	};
	mounted = instance as never;
	// The chart is made by an action, which runs with the effects.
	flushSync();
	return { onLoad, setZone: (zone: 'utc' | 'local') => (instance.setZone(zone), flushSync()) };
};

const hasTimeFormatters = (chart: FakeChart) =>
	Boolean(chart.options.timeScale?.tickMarkFormatter || chart.options.localization?.timeFormatter);

describe('SVELightweightCharts timeZone', () => {
	it('draws a chart without time formatters for UTC, which is what the engine does on its own', () => {
		mountChart();
		expect(fake.charts).toHaveLength(1);
		expect(hasTimeFormatters(fake.charts[0])).toBe(false);
	});

	it('builds a new chart with the local formatters when the time zone changes to "local"', () => {
		const { onLoad, setZone } = mountChart();

		setZone('local');

		expect(fake.charts).toHaveLength(2);
		expect(fake.charts[0].removed).toBe(true);
		expect(hasTimeFormatters(fake.charts[1])).toBe(true);
		// The app is handed the new chart, as it is for the first one.
		expect(onLoad).toHaveBeenCalledTimes(2);
		expect(onLoad).toHaveBeenLastCalledWith(fake.charts[1]);
	});

	// The engine merges `applyOptions` deeply and skips `undefined`, so nothing can take a formatter
	// away from a chart that has one: going back to UTC has to build another chart.
	it('goes back to a chart without time formatters when the time zone returns to "utc"', () => {
		const { setZone } = mountChart();

		setZone('local');
		setZone('utc');

		expect(fake.charts).toHaveLength(3);
		expect(fake.charts[1].removed).toBe(true);
		expect(hasTimeFormatters(fake.charts[2])).toBe(false);
	});
});
