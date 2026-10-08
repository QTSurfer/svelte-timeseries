import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ECharts } from 'echarts/types/dist/core';
import { TimeSeriesChartBuilder } from '../../src/lib/TimeSeriesChartBuilder';
import type { InjectedSeries } from '../../src/lib';

type Option = Record<string, any>;

/** `withEvents` adds the event API the marker hover overlay needs (it needs a DOM too). */
function createMockECharts(withEvents = false) {
	const handlers = new Map<string, (params: unknown) => void>();
	const dom = { appendChild: vi.fn(), clientWidth: 800 };
	return {
		instance: {
			setOption: vi.fn(),
			getOption: vi.fn(() => ({ dataZoom: [{ start: 45, end: 55 }] })),
			dispatchAction: vi.fn(),
			...(withEvents
				? {
						getDom: vi.fn(() => dom),
						on: vi.fn((name: string, handler: (params: unknown) => void) =>
							handlers.set(name, handler)
						)
					}
				: {})
		} as unknown as ECharts,
		handlers,
		dom
	};
}

const lastCall = (echarts: ECharts) => {
	const calls = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls;
	return calls[calls.length - 1] as [Option, { replaceMerge: string[] }];
};
const lastOption = (echarts: ECharts) => lastCall(echarts)[0];
const callCount = (echarts: ECharts) =>
	(echarts.setOption as ReturnType<typeof vi.fn>).mock.calls.length;
const seriesOf = (echarts: ECharts) => lastOption(echarts).series as Option[];

const times = [1000, 2000, 3000, 4000];
const ema: InjectedSeries = { name: 'EMA', times, values: [null, 11, 12, 13] };
const rsi: InjectedSeries = { name: 'RSI', times, values: [40, 50, 60, 70], pane: 1 };

describe('TimeSeriesChartBuilder injected series', () => {
	let mock: ReturnType<typeof createMockECharts>;
	let builder: TimeSeriesChartBuilder;

	beforeEach(() => {
		mock = createMockECharts();
		builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('reports what it supports', () => {
		expect(builder.capabilities).toEqual({
			injectedSeries: true,
			panes: true,
			paneHeights: true,
			injectedMarkers: true,
			markerTooltip: true
		});
	});

	it('adds a named line series with millisecond data, gaps as nulls and its look', () => {
		builder.setInjectedSeries([{ ...ema, color: '#ff0000', lineWidth: 3, lineStyle: 'dotted' }]);

		const series = seriesOf(mock.instance).find((item) => item.id === 'inj:EMA')!;
		expect(series).toMatchObject({
			type: 'line',
			name: 'EMA',
			data: [
				[1000, null],
				[2000, 11],
				[3000, 12],
				[4000, 13]
			],
			lineStyle: { width: 3, type: 'dotted', color: '#ff0000' },
			xAxisIndex: 0,
			yAxisIndex: 0,
			sampling: 'minmax'
		});
	});

	it('shows the series in the legend according to `visible`', () => {
		builder.setInjectedSeries([{ ...ema, visible: false }, rsi]);
		expect(lastOption(mock.instance).legend.selected).toMatchObject({ EMA: false, RSI: true });
	});

	it('keeps the primary dataset series when injected series come and go', () => {
		builder.setInjectedSeries([ema]);
		builder.setInjectedSeries([]);
		expect(seriesOf(mock.instance).some((item) => item.id === 'price')).toBe(true);
	});

	it('does not touch the chart when the request is unchanged', () => {
		builder.setInjectedSeries([ema]);
		const calls = callCount(mock.instance);
		builder.setInjectedSeries([{ ...ema }]);
		expect(callCount(mock.instance)).toBe(calls);
	});

	it('updates a series through merging, without replacing anything', () => {
		builder.setInjectedSeries([ema]);
		builder.setInjectedSeries([{ ...ema, color: '#00ff00' }]);
		expect(lastCall(mock.instance)[1].replaceMerge).toEqual(['dataset']);
		expect(seriesOf(mock.instance).find((item) => item.id === 'inj:EMA')!.lineStyle.color).toBe(
			'#00ff00'
		);
	});

	it('asks the chart to replace series when one is removed so it really disappears', () => {
		builder.setInjectedSeries([ema, rsi]);
		builder.setInjectedSeries([ema]);
		expect(lastCall(mock.instance)[1].replaceMerge).toContain('series');
		expect(seriesOf(mock.instance).some((item) => item.id === 'inj:RSI')).toBe(false);
	});

	it('keeps injected series in the order of the request', () => {
		builder.setInjectedSeries([ema]);
		builder.setInjectedSeries([rsi, ema]);
		const ids = seriesOf(mock.instance)
			.map((item) => item.id)
			.filter((id) => String(id).startsWith('inj:'));
		expect(ids).toEqual(['inj:RSI', 'inj:EMA']);
	});

	it('does not list injected series in the legend of the primary dataset', () => {
		builder.setInjectedSeries([ema]);
		expect(builder.getLegendStatus()).toEqual({ price: true });
	});
});

describe('TimeSeriesChartBuilder panes', () => {
	let mock: ReturnType<typeof createMockECharts>;
	let builder: TimeSeriesChartBuilder;

	beforeEach(() => {
		mock = createMockECharts();
		builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('stacks a second grid under the price grid for pane 1', () => {
		builder.setInjectedSeries([ema, rsi]);

		const option = lastOption(mock.instance);
		expect(option.grid).toHaveLength(2);
		expect(option.xAxis).toHaveLength(2);
		expect(option.yAxis).toHaveLength(3);
		expect(option.yAxis[2].gridIndex).toBe(1);

		const rsiSeries = (option.series as Option[]).find((item) => item.id === 'inj:RSI')!;
		expect(rsiSeries).toMatchObject({ xAxisIndex: 1, yAxisIndex: 2 });
		const emaSeries = (option.series as Option[]).find((item) => item.id === 'inj:EMA')!;
		expect(emaSeries).toMatchObject({ xAxisIndex: 0, yAxisIndex: 0 });
	});

	it('zooms and points every pane together', () => {
		builder.setInjectedSeries([rsi]);
		const option = lastOption(mock.instance);
		expect(option.dataZoom.map((zoom: Option) => zoom.xAxisIndex)).toEqual([
			[0, 1],
			[0, 1]
		]);
		expect(option.axisPointer.link).toEqual([{ xAxisIndex: 'all' }]);
	});

	it('replaces the axis components when the pane count changes, and merges otherwise', () => {
		builder.setInjectedSeries([rsi]);
		expect(lastCall(mock.instance)[1].replaceMerge).toEqual(
			expect.arrayContaining(['grid', 'xAxis', 'yAxis'])
		);

		builder.setInjectedSeries([{ ...rsi, color: 'red' }]);
		expect(lastCall(mock.instance)[1].replaceMerge).toEqual(['dataset']);
	});

	it('returns to the single-pane layout when the last extra pane goes away', () => {
		builder.setInjectedSeries([ema, rsi]);
		builder.setInjectedSeries([ema]);

		const [option, settings] = lastCall(mock.instance);
		expect(settings.replaceMerge).toEqual(expect.arrayContaining(['grid', 'xAxis', 'yAxis']));
		expect(Array.isArray(option.grid)).toBe(false);
		expect(option.yAxis).toHaveLength(2);
		expect(option.dataZoom.map((zoom: Option) => zoom.xAxisIndex)).toEqual([[0], [0]]);
	});

	it('sizes panes by ratio and lets paneHeights change them', () => {
		builder.setInjectedSeries([rsi]);
		const [price, secondary] = lastOption(mock.instance).grid as Option[];
		expect(parseFloat(price.height) / parseFloat(secondary.height)).toBeCloseTo(3, 1);

		builder.setPaneHeights({ 0: 1, 1: 1 });
		const [first, second] = lastOption(mock.instance).grid as Option[];
		expect(parseFloat(first.height)).toBeCloseTo(parseFloat(second.height), 1);
	});

	it('bounds every pane to the data range', () => {
		builder.setInjectedSeries([rsi]);
		builder.setDataRange(1000, 4000);
		const axes = lastOption(mock.instance).xAxis as Option[];
		expect(axes.map((axis) => [axis.min, axis.max])).toEqual([
			[1000, 4000],
			[1000, 4000]
		]);
	});

	it('keeps a custom grid when panes come and go', () => {
		builder.setGrid({ left: '10%' });
		builder.setInjectedSeries([rsi]);
		expect((lastOption(mock.instance).grid as Option[])[0].left).toBe('10%');
		builder.setInjectedSeries([]);
		expect((lastOption(mock.instance).grid as Option).left).toBe('10%');
	});
});

describe('TimeSeriesChartBuilder injected markers', () => {
	let mock: ReturnType<typeof createMockECharts>;
	let builder: TimeSeriesChartBuilder;
	const markerSeries = (echarts: ECharts) =>
		seriesOf(echarts).filter((item) => String(item.id).startsWith('inj-markers:'));

	beforeEach(() => {
		mock = createMockECharts();
		builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('draws markers as mark points of a helper series that shares the host name and axes', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy', text: 'enter' }]);

		const [helper] = markerSeries(mock.instance);
		expect(helper).toMatchObject({ name: 'price', data: [], silent: false });
		expect(helper.markPoint.data).toHaveLength(1);
		expect(helper.markPoint.data[0]).toMatchObject({ coord: [2000, 11] });
		expect(helper.markPoint.data[0].tooltipHtml).toContain('enter');
	});

	it('places a marker at its own price when it has one', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'sell', price: 99 }]);
		expect(markerSeries(mock.instance)[0].markPoint.data[0].coord).toEqual([2000, 99]);
	});

	it('anchors a marker between bars to the bar at or before it', () => {
		builder.setInjectedMarkers([{ time: 3500, kind: 'info' }]);
		expect(markerSeries(mock.instance)[0].markPoint.data[0].coord).toEqual([3500, 12]);
	});

	it('merges the markers of one second with the same look and counts them', () => {
		builder.setInjectedMarkers([
			{ time: 2100, kind: 'buy', text: 'a' },
			{ time: 2500, kind: 'buy', text: 'b' },
			{ time: 2900, kind: 'buy', text: 'c' }
		]);
		const data = markerSeries(mock.instance)[0].markPoint.data;
		expect(data).toHaveLength(1);
		expect(data[0].label.formatter).toBe('×3');
	});

	it('stacks different looks of the same second so none hides another', () => {
		builder.setInjectedMarkers([
			{ time: 2100, kind: 'sell' },
			{ time: 2200, kind: 'info' },
			{ time: 2300, kind: 'buy' }
		]);
		const offsets = markerSeries(mock.instance)[0].markPoint.data.map(
			(item: Option) => item.symbolOffset[1]
		);
		expect(new Set(offsets).size).toBe(3);
	});

	it('attaches markers to the injected series they name, on its pane axes', () => {
		builder.setInjectedSeries([rsi]);
		builder.setInjectedMarkers([{ time: 2000, kind: 'info', series: 'RSI' }]);

		const [helper] = markerSeries(mock.instance);
		expect(helper).toMatchObject({ name: 'RSI', xAxisIndex: 1, yAxisIndex: 2 });
		expect(helper.markPoint.data[0].coord).toEqual([2000, 50]);
	});

	it('waits for a series that does not exist yet', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'info', series: 'RSI' }]);
		expect(markerSeries(mock.instance)).toHaveLength(0);

		builder.setInjectedSeries([rsi]);
		expect(markerSeries(mock.instance)).toHaveLength(1);
	});

	it('removes the helper series and asks the chart to replace series when markers are cleared', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		builder.setInjectedMarkers([]);
		expect(markerSeries(mock.instance)).toHaveLength(0);
		expect(lastCall(mock.instance)[1].replaceMerge).toContain('series');
	});

	it('draws markers on the candlestick series and anchors buys to the low, sells to the high', () => {
		builder.setCandlestickSeries(
			{
				_ts: times,
				open: [1, 2, 3, 4],
				high: [2, 3, 4, 5],
				low: [0, 1, 2, 3],
				close: [1.5, 2.5, 3.5, 4.5]
			},
			{ open: 'open', high: 'high', low: 'low', close: 'close' }
		);
		builder.setInjectedMarkers([
			{ time: 2000, kind: 'buy' },
			{ time: 3000, kind: 'sell' },
			{ time: 4000, kind: 'info', color: 'blue' }
		]);

		const [helper] = markerSeries(mock.instance);
		expect(helper.name).toBe('Candlestick');
		expect(helper.markPoint.data.map((item: Option) => item.coord)).toEqual([
			[2000, 1],
			[3000, 4],
			[4000, 5]
		]);
	});

	it('survives a replaced primary dataset', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		builder.setDataset({ _ts: times, price: [1, 2, 3, 4] });
		expect(markerSeries(mock.instance)[0].markPoint.data[0].coord).toEqual([2000, 2]);
	});

	it('draws the markers of a JSON column on the candlestick series (OHLC column names)', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		builder.setCandlestickSeries(
			{
				_ts: times,
				open: [1, 2, 3, 4],
				high: [2, 3, 4, 5],
				low: [0, 1, 2, 3],
				close: [1, 2, 3, 4]
			},
			{ open: 'open', high: 'high', low: 'low', close: 'close' }
		);
		builder.addMarkerPoint(
			0,
			{ dimName: 'close', timestamp: 2000, name: 'Signal' },
			{ icon: 'circle' }
		);

		const candles = seriesOf(mock.instance).find((item) => item.id === 'candlestick')!;
		expect(candles.markPoint.data).toHaveLength(1);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

const markerSeriesOf = (echarts: ECharts) =>
	seriesOf(echarts).filter((item) => String(item.id).startsWith('inj-markers:'));

describe('TimeSeriesChartBuilder marker hover', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('shows marker texts in an overlay and pauses the axis tooltip while the pointer is on a marker', () => {
		const overlay = {
			style: {} as Record<string, string>,
			setAttribute: vi.fn(),
			innerHTML: '',
			offsetWidth: 100
		};
		vi.stubGlobal('document', { createElement: vi.fn(() => overlay) });
		const mock = createMockECharts(true);
		const builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy', text: 'enter' }]);

		expect(mock.dom.appendChild).toHaveBeenCalledWith(overlay);

		mock.handlers.get('mouseover')!({
			componentType: 'markPoint',
			data: { tooltipHtml: '<b>Buy</b>' },
			event: { offsetX: 20, offsetY: 30 }
		});
		expect(overlay.innerHTML).toBe('<b>Buy</b>');
		expect(overlay.style.display).toBe('block');
		expect(mock.instance.setOption).toHaveBeenLastCalledWith({ tooltip: { show: false } });

		mock.handlers.get('mouseout')!({ componentType: 'markPoint' });
		expect(overlay.style.display).toBe('none');
		expect(mock.instance.setOption).toHaveBeenLastCalledWith({ tooltip: { show: true } });
	});

	it('gives the tooltip back when the hovered marker is removed under the pointer', () => {
		const overlay = {
			style: {} as Record<string, string>,
			setAttribute: vi.fn(),
			innerHTML: '',
			offsetWidth: 100
		};
		vi.stubGlobal('document', { createElement: vi.fn(() => overlay) });
		const mock = createMockECharts(true);
		const builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy', text: 'enter' }]);
		const html = markerSeriesOf(mock.instance)[0].markPoint.data[0].tooltipHtml;
		mock.handlers.get('mouseover')!({
			componentType: 'markPoint',
			data: { tooltipHtml: html },
			event: { offsetX: 20, offsetY: 30 }
		});

		// The same marker is redrawn: the hover goes on.
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy', text: 'enter' }]);
		expect(overlay.style.display).toBe('block');

		// The marker goes away while the pointer is still on it: no `mouseout` will ever come.
		builder.setInjectedMarkers([]);
		expect(overlay.style.display).toBe('none');
		expect(mock.instance.setOption).toHaveBeenCalledWith({ tooltip: { show: true } });
	});

	it('gives the tooltip back when the pointer leaves the chart', () => {
		const overlay = {
			style: {} as Record<string, string>,
			setAttribute: vi.fn(),
			offsetWidth: 100
		};
		vi.stubGlobal('document', { createElement: vi.fn(() => overlay) });
		const mock = createMockECharts(true);
		const builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		mock.handlers.get('mouseover')!({
			componentType: 'markPoint',
			data: { tooltipHtml: '<b>x</b>' },
			event: { offsetX: 1, offsetY: 1 }
		});

		mock.handlers.get('globalout')!({});

		expect(overlay.style.display).toBe('none');
		expect(mock.instance.setOption).toHaveBeenLastCalledWith({ tooltip: { show: true } });
	});

	it('attaches the hover handlers once however often the markers change', () => {
		vi.stubGlobal('document', {
			createElement: vi.fn(() => ({ style: {}, setAttribute: vi.fn() }))
		});
		const mock = createMockECharts(true);
		const builder = new TimeSeriesChartBuilder(mock.instance);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		builder.setInjectedMarkers([{ time: 3000, kind: 'buy' }]);
		expect(mock.instance.on).toHaveBeenCalledTimes(3); // mouseover, mouseout, globalout: once
	});
});
