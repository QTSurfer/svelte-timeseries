import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeriesMarkers } from 'lightweight-charts';
import { LightweightTimeSeriesChartBuilder } from '../../src/lib/LightweightTimeSeriesChartBuilder';
import { getChartHoverHooks } from '../../src/lib/chartHooks';
import type { InjectedMarker, InjectedSeries } from '../../src/lib';

vi.mock('lightweight-charts', () => ({
	LineSeries: Symbol('LineSeries'),
	CandlestickSeries: Symbol('CandlestickSeries'),
	createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() }))
}));

type MockSeries = ReturnType<typeof createMockSeries>;

function createMockSeries(initialPane: number, bars: number[] = []) {
	const state = { pane: initialPane, options: { visible: true } as Record<string, unknown> };
	return {
		state,
		setData: vi.fn(),
		applyOptions: vi.fn((options: Record<string, unknown>) =>
			Object.assign(state.options, options)
		),
		options: vi.fn(() => state.options),
		moveToPane: vi.fn((index: number) => {
			state.pane = index;
		}),
		getPane: () => ({ paneIndex: () => state.pane }),
		priceFormatter: () => ({ format: (value: number) => `~${value.toFixed(1)}` }),
		// Bars sit at their index: dataByIndex(i, direction) finds the bar at/near i.
		dataByIndex: vi.fn((index: number, direction: number) => {
			if (bars.length === 0) return null;
			const exact = bars.indexOf(index);
			if (exact >= 0) return { time: bars[exact] };
			if (direction < 0) {
				const left = bars.filter((bar) => bar < index);
				return left.length ? { time: left[left.length - 1] } : null;
			}
			const right = bars.filter((bar) => bar > index);
			return right.length ? { time: right[0] } : null;
		})
	};
}

function createMockChart() {
	const series: MockSeries[] = [];
	const panes: {
		setStretchFactor: ReturnType<typeof vi.fn>;
		setPreserveEmptyPane: ReturnType<typeof vi.fn>;
	}[] = [{ setStretchFactor: vi.fn(), setPreserveEmptyPane: vi.fn() }];
	const ensurePane = (index: number) => {
		const clamped = Math.min(index, panes.length);
		if (clamped === panes.length) {
			panes.push({ setStretchFactor: vi.fn(), setPreserveEmptyPane: vi.fn() });
		}
		return clamped;
	};

	const visibleRange: { from: number; to: number } | null = { from: 100, to: 200 };
	const timeScale = {
		getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 10 })),
		getVisibleRange: vi.fn(() => visibleRange),
		timeToIndex: vi.fn(() => 10),
		setVisibleLogicalRange: vi.fn(),
		setVisibleRange: vi.fn(),
		fitContent: vi.fn()
	};

	const chart = {
		addSeries: vi.fn((_definition: unknown, _options: Record<string, unknown>, paneIndex = 0) => {
			const created = createMockSeries(ensurePane(paneIndex));
			series.push(created);
			return created;
		}),
		removeSeries: vi.fn(),
		applyOptions: vi.fn(),
		panes: vi.fn(() => panes),
		timeScale: vi.fn(() => timeScale)
	};

	return {
		chart,
		series,
		panes,
		timeScale
	};
}

const times = [1000, 2000, 3000, 4000];
const ema: InjectedSeries = { name: 'EMA', times, values: [null, 11, 12, 13] };
const rsi: InjectedSeries = { name: 'RSI', times, values: [40, 50, 60, 70], pane: 1 };

describe('LightweightTimeSeriesChartBuilder injected series', () => {
	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
		// Only the view changes made by the injected series are of interest below.
		Object.values(mock.timeScale).forEach((fn) => fn.mockClear());
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

	it('adds a named line series with the requested look and gaps as whitespace', () => {
		builder.setInjectedSeries([
			{ ...ema, color: '#ff0000', lineWidth: 3, lineStyle: 'dashed', visible: false }
		]);

		const [, options, paneIndex] = mock.chart.addSeries.mock.calls[1];
		expect(options).toMatchObject({
			title: 'EMA',
			color: '#ff0000',
			lineWidth: 3,
			lineStyle: 2,
			visible: false,
			priceScaleId: 'right'
		});
		expect(paneIndex).toBe(0);
		expect(mock.series[1].setData).toHaveBeenCalledWith([
			{ time: 1 },
			{ time: 2, value: 11 },
			{ time: 3, value: 12 },
			{ time: 4, value: 13 }
		]);
	});

	it('picks a stable default color per series', () => {
		builder.setInjectedSeries([ema, rsi]);
		const colors = mock.chart.addSeries.mock.calls.slice(1).map((call) => call[1].color);
		expect(colors[0]).not.toBe(colors[1]);
	});

	it('accepts typed arrays', () => {
		builder.setInjectedSeries([
			{ name: 'typed', times: new Float64Array(times), values: new Float64Array([1, 2, 3, 4]) }
		]);
		expect(mock.series[1].setData).toHaveBeenCalledWith(
			expect.arrayContaining([{ time: 4, value: 4 }])
		);
	});

	it('does nothing when the request is unchanged', () => {
		builder.setInjectedSeries([ema]);
		const calls = mock.chart.addSeries.mock.calls.length;
		mock.series.forEach((item) => item.setData.mockClear());

		builder.setInjectedSeries([{ ...ema }]);

		expect(mock.chart.addSeries).toHaveBeenCalledTimes(calls);
		expect(mock.chart.removeSeries).not.toHaveBeenCalled();
		expect(mock.series[1].setData).not.toHaveBeenCalled();
		expect(mock.series[1].applyOptions).not.toHaveBeenCalled();
	});

	it('updates only what changed, without recreating the series', () => {
		builder.setInjectedSeries([ema]);
		const injected = mock.series[1];
		injected.setData.mockClear();
		injected.applyOptions.mockClear();

		builder.setInjectedSeries([{ ...ema, color: '#00ff00', lineStyle: 'dotted' }]);
		expect(injected.setData).not.toHaveBeenCalled();
		expect(injected.applyOptions).toHaveBeenCalledWith({
			color: '#00ff00',
			lineWidth: 1,
			lineStyle: 1
		});

		injected.applyOptions.mockClear();
		builder.setInjectedSeries([{ ...ema, color: '#00ff00', lineStyle: 'dotted', visible: false }]);
		expect(injected.applyOptions).toHaveBeenCalledWith({ visible: false });
		expect(mock.chart.addSeries).toHaveBeenCalledTimes(2);

		builder.setInjectedSeries([
			{ ...ema, color: '#00ff00', lineStyle: 'dotted', visible: false, values: [1, 2, 3, 4] }
		]);
		expect(injected.setData).toHaveBeenCalledTimes(1);
		expect(mock.chart.removeSeries).not.toHaveBeenCalled();
	});

	it('removes a series that is no longer requested and its markers plugin', () => {
		builder.setInjectedSeries([ema]);
		builder.setInjectedMarkers([{ time: 2000, kind: 'info', series: 'EMA' }]);
		const plugin = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;

		builder.setInjectedSeries([]);

		expect(mock.chart.removeSeries).toHaveBeenCalledWith(mock.series[1]);
		expect(plugin.detach).toHaveBeenCalled();
	});

	it('puts the view back on the same bars when the new series shifts the time scale', () => {
		// The bar at the left edge moves from index 10 to 40 (30 points were inserted before it) and
		// the chart moved the window by its own rule, to 60..70.
		mock.timeScale.timeToIndex.mockReturnValueOnce(10).mockReturnValue(40);
		mock.timeScale.getVisibleLogicalRange
			.mockReturnValueOnce({ from: 0, to: 10 })
			.mockReturnValue({ from: 60, to: 70 });

		builder.setInjectedSeries([ema]);

		expect(mock.timeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 30, to: 40 });
	});

	it('leaves the view alone when the scale did not change', () => {
		builder.setInjectedSeries([ema]);
		expect(mock.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
		expect(mock.timeScale.setVisibleRange).not.toHaveBeenCalled();
	});

	it('leaves the view alone when the chart already moved it with the bars', () => {
		mock.timeScale.timeToIndex.mockReturnValueOnce(10).mockReturnValue(40);
		mock.timeScale.getVisibleLogicalRange
			.mockReturnValueOnce({ from: 0, to: 10 })
			.mockReturnValue({ from: 30, to: 40 });

		builder.setInjectedSeries([ema]);

		expect(mock.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
	});

	it('fits an empty chart that only has injected series', () => {
		const empty = createMockChart();
		empty.timeScale.getVisibleRange.mockReturnValue(null as never);
		const injectedOnly = new LightweightTimeSeriesChartBuilder(empty.chart as never);

		injectedOnly.setInjectedSeries([ema]);

		expect(empty.timeScale.fitContent).toHaveBeenCalled();
	});

	it('does not fit when a price series defines the view', () => {
		mock.timeScale.getVisibleRange.mockReturnValue(null as never);
		mock.timeScale.fitContent.mockClear();
		builder.setInjectedSeries([ema]);
		expect(mock.timeScale.fitContent).not.toHaveBeenCalled();
	});

	it('toggles an injected series by name', () => {
		builder.setInjectedSeries([ema]);
		builder.toggleLegend('EMA');
		expect(mock.series[1].applyOptions).toHaveBeenLastCalledWith({ visible: false });
	});

	it('does not list injected series in the legend of the primary dataset', () => {
		builder.setInjectedSeries([ema]);
		expect(builder.getLegendStatus()).toEqual({ price: true });
	});

	it('never throws on a malformed request; it warns once and skips the entry', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		builder.setInjectedSeries([{ name: '', times, values: [] }, ema]);
		builder.setInjectedSeries([{ name: '', times, values: [] }, ema]);
		expect(mock.chart.addSeries).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('shows indicator values with the precision of their magnitude, not of their noise', () => {
		builder.setInjectedSeries([
			{ name: 'noisy', times: [1000, 2000], values: [55.12345678901234, 61.98765432109876] }
		]);
		const [, options] = mock.chart.addSeries.mock.calls[1];
		expect(options.priceFormat).toEqual({ type: 'price', precision: 3, minMove: 0.001 });
	});
});

describe('LightweightTimeSeriesChartBuilder panes', () => {
	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('creates the series in the pane it asks for', () => {
		builder.setInjectedSeries([ema, rsi]);
		expect(mock.chart.addSeries.mock.calls.map((call) => call[2] ?? 0)).toEqual([0, 0, 1]);
	});

	it('collapses gaps in pane numbers into consecutive panes', () => {
		builder.setInjectedSeries([
			{ ...ema, pane: 3 },
			{ ...rsi, pane: 9 }
		]);
		expect(mock.series.slice(1).map((item) => item.state.pane)).toEqual([1, 2]);
	});

	it('moves a series when its pane changes', () => {
		builder.setInjectedSeries([rsi]);
		builder.setInjectedSeries([{ ...rsi, pane: 0 }]);
		expect(mock.series[1].moveToPane).toHaveBeenCalledWith(0);
	});

	it('gives the price pane three times the height of the others by default', () => {
		builder.setInjectedSeries([rsi]);
		expect(mock.panes[0].setStretchFactor).toHaveBeenCalledWith(3);
		expect(mock.panes[1].setStretchFactor).toHaveBeenCalledWith(1);
	});

	it('keeps an emptied price pane so the other panes do not shift', () => {
		builder.setInjectedSeries([rsi]);
		expect(mock.panes[0].setPreserveEmptyPane).toHaveBeenCalledWith(true);
	});

	it('applies configured pane heights by pane number', () => {
		builder.setInjectedSeries([rsi]);
		builder.setPaneHeights({ 0: 1, 1: 1 });
		expect(mock.panes[0].setStretchFactor).toHaveBeenLastCalledWith(1);
	});

	it('does not reset the pane heights on later updates', () => {
		builder.setInjectedSeries([rsi]);
		mock.panes.forEach((pane) => pane.setStretchFactor.mockClear());
		builder.setInjectedSeries([{ ...rsi, color: 'red' }]);
		expect(mock.panes[0].setStretchFactor).not.toHaveBeenCalled();
	});
});

describe('LightweightTimeSeriesChartBuilder injected markers', () => {
	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;
	const pluginFor = (series: unknown) => {
		const index = vi.mocked(createSeriesMarkers).mock.calls.findIndex((call) => call[0] === series);
		return index < 0 ? undefined : vi.mocked(createSeriesMarkers).mock.results[index].value;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('draws a buy below the bar and a sell above it on the price series by default', () => {
		builder.setInjectedMarkers([
			{ time: 2000, kind: 'buy' },
			{ time: 3000, kind: 'sell' }
		]);
		expect(pluginFor(mock.series[0]).setMarkers).toHaveBeenLastCalledWith([
			{ time: 2, color: '#16a34a', shape: 'arrowUp', position: 'belowBar' },
			{ time: 3, color: '#dc2626', shape: 'arrowDown', position: 'aboveBar' }
		]);
	});

	it('anchors markers that carry a price at that price', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy', price: 10.5, text: 'x' }]);
		expect(pluginFor(mock.series[0]).setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ position: 'atPriceBottom', price: 10.5 })
		]);
	});

	it('merges markers of the same second and look into one counted glyph', () => {
		builder.setInjectedMarkers([
			{ time: 2100, kind: 'buy', text: 'a' },
			{ time: 2400, kind: 'buy', text: 'b' },
			{ time: 2900, kind: 'buy', text: 'c' }
		]);
		const markers = pluginFor(mock.series[0]).setMarkers.mock.lastCall[0];
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({ time: 2, text: '×3' });
	});

	it('keeps markers of different looks in the same second so the chart stacks them', () => {
		builder.setInjectedMarkers([
			{ time: 2100, kind: 'sell' },
			{ time: 2200, kind: 'info' },
			{ time: 2300, kind: 'buy' }
		]);
		const markers = pluginFor(mock.series[0]).setMarkers.mock.lastCall[0];
		expect(markers.map((marker: { shape: string }) => marker.shape)).toEqual([
			'arrowDown',
			'circle',
			'arrowUp'
		]);
	});

	it('hands the chart markers sorted by time', () => {
		builder.setInjectedMarkers([
			{ time: 4000, kind: 'info' },
			{ time: 1000, kind: 'info' },
			{ time: 3000, kind: 'info', color: 'red' }
		]);
		const seconds = pluginFor(mock.series[0]).setMarkers.mock.lastCall[0].map(
			(marker: { time: number }) => marker.time
		);
		expect(seconds).toEqual([1, 3, 4]);
	});

	it('does not change the visible range for injected markers', () => {
		builder.setInjectedMarkers([{ time: 9_999_000, kind: 'info' }]);
		expect(mock.timeScale.setVisibleRange).not.toHaveBeenCalled();
	});

	it('attaches markers to the injected series they name, in its own pane', () => {
		builder.setInjectedSeries([rsi]);
		builder.setInjectedMarkers([{ time: 2000, kind: 'info', series: 'RSI' }]);
		expect(pluginFor(mock.series[1]).setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ time: 2, shape: 'circle' })
		]);
		expect(pluginFor(mock.series[0])?.setMarkers.mock.lastCall?.[0] ?? []).toEqual([]);
	});

	it('waits for a series that does not exist yet instead of dropping the marker', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'info', series: 'RSI' }]);
		expect(pluginFor(mock.series[0]).setMarkers).toHaveBeenLastCalledWith([]);

		builder.setInjectedSeries([rsi]);
		expect(pluginFor(mock.series[1]).setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ time: 2 })
		]);
	});

	it('clears injected markers when the list is emptied', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'info' }]);
		builder.setInjectedMarkers([]);
		expect(pluginFor(mock.series[0]).setMarkers).toHaveBeenLastCalledWith([]);
	});

	it('keeps injected markers when the primary dataset is replaced', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'sell' }]);
		builder.setDataset({ _ts: times, price: [1, 2, 3, 4] });
		const latest = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;
		expect(latest.setMarkers).toHaveBeenLastCalledWith([expect.objectContaining({ time: 2 })]);
	});

	it('keeps JSON column markers next to injected ones on the same series', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000, name: 'market' });
		builder.setInjectedMarkers([{ time: 3000, kind: 'buy' }]);
		const markers = pluginFor(mock.series[0]).setMarkers.mock.lastCall[0];
		expect(markers.map((marker: { time: number }) => marker.time)).toEqual([2, 3]);
		expect(markers[0].text).toBe('market');
	});

	it('clearMarkers removes JSON column markers only', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000, name: 'market' });
		builder.setInjectedMarkers([{ time: 3000, kind: 'buy' }]);
		builder.clearMarkers();
		expect(pluginFor(mock.series[0]).setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ time: 3 })
		]);
	});
});

describe('LightweightTimeSeriesChartBuilder JSON column markers in the same second', () => {
	it('shows every marker instead of keeping only the first', () => {
		vi.clearAllMocks();
		const mock = createMockChart();
		const builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });

		builder.addMarkerPoint(
			1,
			{ dimName: 'price', timestamp: 2100, name: '-1,10%' },
			{ icon: 'arrowDown', color: 'red' }
		);
		builder.addMarkerPoint(
			2,
			{ dimName: 'price', timestamp: 2400, name: 'market' },
			{ icon: 'square', color: 'red' }
		);
		builder.addMarkerPoint(
			3,
			{ dimName: 'price', timestamp: 2700, name: 'market' },
			{ icon: 'square', color: 'red' }
		);

		const plugin = vi.mocked(createSeriesMarkers).mock.results[0].value;
		const markers = plugin.setMarkers.mock.lastCall[0];
		expect(markers).toHaveLength(2);
		expect(markers.map((marker: { text: string }) => marker.text)).toEqual(['-1,10%', '×2']);
	});
});

describe('LightweightTimeSeriesChartBuilder candlestick markers', () => {
	const dims = { open: 'open', high: 'high', low: 'low', close: 'close' };
	const candles = {
		_ts: times,
		open: [1, 2, 3, 4],
		high: [2, 3, 4, 5],
		low: [0, 1, 2, 3],
		close: [1.5, 2.5, 3.5, 4.5]
	};
	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setCandlestickSeries(candles, dims);
	});

	it('draws injected markers on the candlestick series', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		const plugin = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;
		expect(vi.mocked(createSeriesMarkers).mock.calls.at(-1)![0]).toBe(mock.series[0]);
		expect(plugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ time: 2, position: 'belowBar' })
		]);
	});

	it('draws markers added for an OHLC column on the candlestick series', () => {
		builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2000, name: 'Signal' });
		const plugin = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;
		expect(vi.mocked(createSeriesMarkers).mock.calls.at(-1)![0]).toBe(mock.series[0]);
		expect(plugin.setMarkers).toHaveBeenLastCalledWith([
			expect.objectContaining({ text: 'Signal' })
		]);
	});

	it('moves markers to the new candlestick series when the candles are rebuilt', () => {
		builder.setInjectedMarkers([{ time: 2000, kind: 'buy' }]);
		const first = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;

		builder.setCandlestickSeries(candles, dims);

		expect(first.detach).toHaveBeenCalled();
		const latest = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;
		expect(latest).not.toBe(first);
		expect(latest.setMarkers).toHaveBeenLastCalledWith([expect.objectContaining({ time: 2 })]);
	});
});

describe('LightweightTimeSeriesChartBuilder hover hooks', () => {
	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;
	const hover = (logical: number) =>
		getChartHoverHooks(mock.chart)!.getMarkerHover({ logical } as never);

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: [1000, 2000, 3000, 4000], price: [10, 11, 12, 13] });
		// The price series has bars at chart indexes 10, 20 and 30 (seconds 10, 20, 30).
		mock.series[0].dataByIndex.mockImplementation((index: number, direction: number) => {
			const bars = [10, 20, 30];
			const found =
				direction < 0
					? bars.filter((bar) => bar <= index).at(-1)
					: bars.find((bar) => bar >= index);
			return found === undefined ? null : { time: found };
		});
	});

	const markersAt = (...ms: number[]): InjectedMarker[] =>
		ms.map((time, index) => ({ time, kind: 'info', text: `m${index}` }));

	it('registers itself for the chart it was created with', () => {
		expect(getChartHoverHooks(mock.chart)).toBeDefined();
	});

	it('lists the markers drawn on the bar under the crosshair, texts included', () => {
		builder.setInjectedMarkers([
			{ time: 20_000, kind: 'buy', text: 'enter' },
			{ time: 20_400, kind: 'sell', text: 'exit' },
			{ time: 29_999, kind: 'info', text: 'late in the bar' }
		]);
		const result = hover(20)!;
		expect(result.items.map((item) => item.text)).toEqual(['enter', 'exit', 'late in the bar']);
		expect(result.items[0].kindLabel).toBe('Buy');
	});

	it('does not list markers that belong to a neighboring bar', () => {
		builder.setInjectedMarkers(markersAt(10_000, 20_000, 30_000));
		expect(hover(20)!.items.map((item) => item.text)).toEqual(['m1']);
		expect(hover(10)!.items.map((item) => item.text)).toEqual(['m0']);
	});

	it('treats everything after the last bar as part of the last bar', () => {
		builder.setInjectedMarkers(markersAt(30_000, 95_000));
		expect(hover(30)!.items).toHaveLength(2);
	});

	it('returns nothing where there is no marker, no markers at all, or no position', () => {
		expect(hover(20)).toBeNull();
		builder.setInjectedMarkers(markersAt(10_000));
		expect(hover(20)).toBeNull();
		expect(getChartHoverHooks(mock.chart)!.getMarkerHover({} as never)).toBeNull();
	});

	it('ignores the markers of a hidden series', () => {
		builder.setInjectedMarkers(markersAt(20_000));
		mock.series[0].state.options.visible = false;
		expect(hover(20)).toBeNull();
	});

	it('merged markers list every original text', () => {
		builder.setInjectedMarkers([
			{ time: 20_100, kind: 'buy', text: 'fill 1' },
			{ time: 20_500, kind: 'buy', text: 'fill 2' }
		]);
		expect(hover(20)!.items.map((item) => item.text)).toEqual(['fill 1', 'fill 2']);
	});

	it('formats values of injected series with their own price formatter only', () => {
		builder.setInjectedSeries([ema]);
		const hooks = getChartHoverHooks(mock.chart)!;
		expect(hooks.formatValue(mock.series[1] as never, 12.345)).toBe('~12.3');
		expect(hooks.formatValue(mock.series[0] as never, 12.345)).toBeUndefined();
	});
});
