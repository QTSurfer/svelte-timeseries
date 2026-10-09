import { describe, expect, it, vi } from 'vitest';
import type { ECharts } from 'echarts/types/dist/core';
import { describeUnsupportedInput } from '../../src/lib/inputSupport';
import type { TimeSeriesChartAdapter } from '../../src/lib/chartAdapter';
import { TimeSeriesChartBuilder } from '../../src/lib/TimeSeriesChartBuilder';
import { VelaTimeSeriesChartBuilder } from '../../src/lib/VelaTimeSeriesChartBuilder';

vi.mock('@luxalgo/vela', () => ({ registerNativeIndicator: vi.fn() }));

const series = [{ name: 'EMA', times: [1], values: [1] }];
const markers = [{ time: 1, kind: 'buy' as const }];
const all = { injectedSeries: series, injectedMarkers: markers, paneHeights: { 0: 3, 1: 1 } };

const velaBuilder = () =>
	new VelaTimeSeriesChartBuilder({
		setMarket: vi.fn(() => Promise.resolve()),
		getVisibleRange: vi.fn(() => null),
		setVisibleRange: vi.fn(),
		addNativeIndicator: vi.fn(() => ({ remove: vi.fn() }))
	} as never);

const echartsBuilder = () =>
	new TimeSeriesChartBuilder({
		setOption: vi.fn(),
		getOption: vi.fn(() => ({ dataZoom: [{ start: 45, end: 55 }] })),
		dispatchAction: vi.fn()
	} as unknown as ECharts);

describe('describeUnsupportedInput', () => {
	it('the Vela builder reports that it draws none of the injected input', () => {
		expect(velaBuilder().capabilities).toEqual({
			injectedSeries: false,
			panes: false,
			paneHeights: false,
			injectedMarkers: false,
			markerTooltip: false
		});
	});

	it('warns once per input that Vela cannot draw, naming the input and the engine', () => {
		const issues = describeUnsupportedInput(velaBuilder(), 'vela', all);
		expect(issues).toHaveLength(3);
		expect(issues[0]).toContain('chartLibrary="vela"');
		expect(issues[0]).toContain('"injectedSeries"');
		expect(issues[1]).toContain('"injectedMarkers"');
		expect(issues[2]).toContain('"paneHeights"');
	});

	it('only mentions what was given', () => {
		const issues = describeUnsupportedInput(velaBuilder(), 'vela', { injectedMarkers: markers });
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('"injectedMarkers"');
	});

	it('says nothing for empty, null or missing input', () => {
		expect(describeUnsupportedInput(velaBuilder(), 'vela', {})).toEqual([]);
		expect(
			describeUnsupportedInput(velaBuilder(), 'vela', {
				injectedSeries: [],
				injectedMarkers: null,
				paneHeights: {}
			})
		).toEqual([]);
	});

	it('says nothing for an engine that draws everything', () => {
		expect(describeUnsupportedInput(echartsBuilder(), 'echarts', all)).toEqual([]);
	});

	it('trusts the capability report over the presence of a member', () => {
		const adapter = {
			capabilities: { injectedSeries: true },
			setInjectedSeries: vi.fn(),
			setInjectedMarkers: vi.fn(),
			setPaneHeights: vi.fn()
		} as unknown as TimeSeriesChartAdapter;
		const issues = describeUnsupportedInput(adapter, 'custom', all);
		expect(issues).toHaveLength(2);
		expect(issues.join(' ')).not.toContain('"injectedSeries"');
	});

	it('judges an adapter without a capability report by its members', () => {
		const adapter = { setInjectedSeries: vi.fn() } as unknown as TimeSeriesChartAdapter;
		const issues = describeUnsupportedInput(adapter, 'custom', all);
		expect(issues).toHaveLength(2);
		expect(issues.join(' ')).not.toContain('"injectedSeries"');
	});

	it('flags a feature whose member is missing even when the report claims support', () => {
		const adapter = {
			capabilities: { injectedMarkers: true }
		} as unknown as TimeSeriesChartAdapter;
		expect(describeUnsupportedInput(adapter, 'custom', { injectedMarkers: markers })).toHaveLength(
			1
		);
	});
});
