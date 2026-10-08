/**
 * Markers that come from the JSON column (`addMarkerPoint`) and markers the host app passes in
 * (`setInjectedMarkers`) live in the same builders. These tests pin how the two coexist: which
 * sample each one anchors to, what time a merged marker carries, which default shape an unset icon
 * gets, and that one source never erases the other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeriesMarkers } from 'lightweight-charts';
import type { ECharts } from 'echarts/types/dist/core';
import { TimeSeriesChartBuilder } from '../../src/lib/TimeSeriesChartBuilder';
import { LightweightTimeSeriesChartBuilder } from '../../src/lib/LightweightTimeSeriesChartBuilder';
import { getChartHoverHooks } from '../../src/lib/chartHooks';

vi.mock('lightweight-charts', () => ({
	LineSeries: Symbol('LineSeries'),
	CandlestickSeries: Symbol('CandlestickSeries'),
	createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() }))
}));

type Option = Record<string, any>;

const CIRCLE_PREFIX = 'path://M16 0c-8.837';

describe('ECharts: JSON column markers and injected markers', () => {
	let echarts: ECharts;
	let builder: TimeSeriesChartBuilder;

	const series = () => {
		const calls = (echarts.setOption as ReturnType<typeof vi.fn>).mock.calls;
		return calls[calls.length - 1][0].series as Option[];
	};
	const hostOf = (id: string) => series().find((item) => item.id === id)!;
	const helpers = () => series().filter((item) => String(item.id).startsWith('inj-markers:'));

	beforeEach(() => {
		echarts = {
			setOption: vi.fn(),
			getOption: vi.fn(() => ({ dataZoom: [{ start: 45, end: 55 }] })),
			dispatchAction: vi.fn()
		} as unknown as ECharts;
		builder = new TimeSeriesChartBuilder(echarts);
	});

	describe('anchoring', () => {
		// The sample at 2000 has no value, so a marker near it has to look further.
		const sparse = { _ts: [1000, 2000, 3000, 4000], price: [10, null, 30, 40] };

		it('a JSON marker keeps its own time and takes the value of the closest sample that has one', () => {
			builder.setDataset(sparse);
			builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2100 });

			const [point] = hostOf('price').markPoint.data;
			expect(point.coord).toEqual([2100, 30]);
		});

		it('an injected marker without a price takes the bar at or before its time', () => {
			builder.setDataset(sparse);
			builder.setInjectedMarkers([{ time: 2100, kind: 'buy' }]);

			const [point] = helpers()[0].markPoint.data;
			expect(point.coord[0]).toBe(2100);
			// 2000 has no value, so the walk goes back to 1000: not the closest sample (3000).
			expect(point.coord[1]).toBe(10);
		});

		it('an injected marker with a price ignores the series values', () => {
			builder.setDataset(sparse);
			builder.setInjectedMarkers([{ time: 2100, kind: 'sell', price: 99 }]);
			expect(helpers()[0].markPoint.data[0].coord).toEqual([2100, 99]);
		});

		it('a JSON marker on a candlestick column anchors to the closest bar and draws on the candles', () => {
			builder.setCandlestickSeries(
				{
					_ts: [1000, 2000, 3000, 4000],
					open: [1, 2, 3, 4],
					high: [2, 3, 4, 5],
					low: [0, 1, 2, 3],
					close: [1.5, 2.5, 3.5, 4.5]
				},
				{ open: 'open', high: 'high', low: 'low', close: 'close' }
			);
			builder.addMarkerPoint(1, { dimName: 'close', timestamp: 2600 });

			const candles = hostOf('candlestick');
			expect(candles.markPoint.data).toHaveLength(1);
			expect(candles.markPoint.data[0].coord).toEqual([2600, 3.5]);
			// No extra line series was created for the column.
			expect(series().filter((item) => item.encode?.y === 'close')).toHaveLength(0);
		});

		it('toggles a candlestick marker off and back on with a visible symbol', () => {
			builder.setCandlestickSeries(
				{ _ts: [1000, 2000], open: [1, 2], high: [2, 3], low: [0, 1], close: [1.5, 2.5] },
				{ open: 'open', high: 'high', low: 'low', close: 'close' }
			);
			builder.addMarkerPoint(7, { dimName: 'close', timestamp: 2000 });
			const [point] = hostOf('candlestick').markPoint.data;
			expect(point.symbol).toMatch(CIRCLE_PREFIX);

			builder.toggleMarkers(7, 'close', 'none');
			expect(point.symbol).toBe('none');
			builder.toggleMarkers(7, 'close', 'none');
			expect(point.symbol).toMatch(CIRCLE_PREFIX);
		});
	});

	describe('same second', () => {
		beforeEach(() => builder.setDataset({ _ts: [1000, 2000, 3000], price: [10, 11, 12] }));

		it('injected markers that look alike merge into one glyph at the time of the earliest', () => {
			builder.setInjectedMarkers([
				{ time: 2400, kind: 'buy', text: 'second fill' },
				{ time: 2100, kind: 'buy', text: 'first fill' }
			]);

			const points = helpers()[0].markPoint.data;
			expect(points).toHaveLength(1);
			expect(points[0].coord[0]).toBe(2100);
			expect(points[0].label.formatter).toBe('×2');
			expect(points[0].tooltipHtml).toContain('first fill');
			expect(points[0].tooltipHtml).toContain('second fill');
		});

		it('JSON markers are never merged: each stays at its own time', () => {
			builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2100, name: 'a' });
			builder.addMarkerPoint(2, { dimName: 'price', timestamp: 2400, name: 'b' });
			expect(hostOf('price').markPoint.data.map((point: Option) => point.coord[0])).toEqual([
				2100, 2400
			]);
		});
	});

	describe('both sources on one chart', () => {
		beforeEach(() => {
			builder.setDataset({ _ts: [1000, 2000, 3000, 4000], price: [10, 11, 12, 13] });
			builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2000, name: 'json' });
			builder.setInjectedMarkers([{ time: 3000, kind: 'buy', text: 'injected' }]);
		});

		it('keeps the JSON marker on the series and the injected one on its helper series', () => {
			expect(hostOf('price').markPoint.data.map((point: Option) => point.name)).toEqual([
				'markerpoint-1'
			]);
			expect(helpers()).toHaveLength(1);
			expect(helpers()[0].markPoint.data).toHaveLength(1);
		});

		it('replacing or emptying the injected markers leaves the JSON marker alone', () => {
			builder.setInjectedMarkers([]);
			expect(helpers()).toHaveLength(0);
			expect(hostOf('price').markPoint.data).toHaveLength(1);
		});

		it('clearMarkers removes the JSON markers only', () => {
			builder.clearMarkers();
			expect(hostOf('price').markPoint.data).toHaveLength(0);
			expect(helpers()).toHaveLength(1);
			expect(helpers()[0].markPoint.data).toHaveLength(1);
		});

		it('a marker toggled off and on keeps its place next to the injected one', () => {
			builder.toggleMarkers(1, 'price', 'arrowUp');
			expect(hostOf('price').markPoint.data[0].symbol).toBe('none');
			builder.toggleMarkers(1, 'price', 'arrowUp');
			expect(hostOf('price').markPoint.data[0].symbol).toMatch(/^path:\/\//);
			expect(helpers()[0].markPoint.data).toHaveLength(1);
		});
	});
});

describe('Lightweight Charts: JSON column markers and injected markers', () => {
	const times = [1000, 2000, 3000, 4000];

	function createMockChart() {
		const series: ReturnType<typeof createMockSeries>[] = [];
		const timeScale = {
			getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 10 })),
			getVisibleRange: vi.fn(() => ({ from: 100, to: 200 })),
			timeToIndex: vi.fn(() => 10),
			setVisibleLogicalRange: vi.fn(),
			setVisibleRange: vi.fn(),
			fitContent: vi.fn()
		};
		const chart = {
			addSeries: vi.fn(() => {
				const created = createMockSeries();
				series.push(created);
				return created;
			}),
			removeSeries: vi.fn(),
			applyOptions: vi.fn(),
			panes: vi.fn(() => [{ setStretchFactor: vi.fn(), setPreserveEmptyPane: vi.fn() }]),
			timeScale: vi.fn(() => timeScale)
		};
		return { chart, series };
	}

	function createMockSeries() {
		const options: Record<string, unknown> = { visible: true };
		return {
			setData: vi.fn(),
			applyOptions: vi.fn((next: Record<string, unknown>) => Object.assign(options, next)),
			options: vi.fn(() => options),
			moveToPane: vi.fn(),
			getPane: () => ({ paneIndex: () => 0 }),
			priceFormatter: () => ({ format: (value: number) => String(value) }),
			// One bar per chart index 10, 20, 30 (seconds).
			dataByIndex: vi.fn((index: number, direction: number) => {
				const bars = [10, 20, 30];
				const found =
					direction < 0
						? bars.filter((bar) => bar <= index).at(-1)
						: bars.find((bar) => bar >= index);
				return found === undefined ? null : { time: found };
			})
		};
	}

	let mock: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;
	const lastMarkers = () => {
		const plugin = vi.mocked(createSeriesMarkers).mock.results.at(-1)!.value;
		return plugin.setMarkers.mock.lastCall[0] as Option[];
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(mock.chart as never);
		builder.setDataset({ _ts: times, price: [10, 11, 12, 13] });
	});

	it('draws a circle when the icon is unset, "none" or empty, like the other engines', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 1000 });
		builder.addMarkerPoint(2, { dimName: 'price', timestamp: 2000 }, { icon: 'none' });
		builder.addMarkerPoint(3, { dimName: 'price', timestamp: 3000 }, { icon: '' });
		expect(lastMarkers().map((marker) => marker.shape)).toEqual(['circle', 'circle', 'circle']);
	});

	it('still collapses an ECharts-only shape to a square', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 1000 }, { icon: 'diamond' });
		expect(lastMarkers()[0].shape).toBe('square');
	});

	it('gives JSON markers the library default size (1) unless one is set', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 1000 });
		builder.addMarkerPoint(2, { dimName: 'price', timestamp: 2000 }, { symbolSize: 3 });
		expect(lastMarkers().map((marker) => marker.size)).toEqual([1, 3]);
	});

	it('keys the merge on the whole second, so two JSON markers 300 ms apart become one glyph', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 2100, name: 'a' }, { icon: 'circle' });
		builder.addMarkerPoint(2, { dimName: 'price', timestamp: 2400, name: 'b' }, { icon: 'circle' });
		const markers = lastMarkers();
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({ time: 2, text: '×2', shape: 'circle' });
	});

	it('merges a JSON marker and an injected marker that look the same, and lists both on hover', () => {
		builder.addMarkerPoint(
			1,
			{ dimName: 'price', timestamp: 20_100, name: 'from the file' },
			{ icon: 'arrowUp', color: '#16a34a', position: 'belowBar' }
		);
		builder.setInjectedMarkers([{ time: 20_400, kind: 'buy', text: 'from the app' }]);

		const markers = lastMarkers();
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({ time: 20, shape: 'arrowUp', text: '×2' });

		mock.series[0].dataByIndex.mockImplementation((index: number, direction: number) => {
			const bars = [10, 20, 30];
			const found =
				direction < 0
					? bars.filter((bar) => bar <= index).at(-1)
					: bars.find((bar) => bar >= index);
			return found === undefined ? null : { time: found };
		});
		const hover = getChartHoverHooks(mock.chart)!.getMarkerHover({ logical: 20 } as never)!;
		expect(hover.items.map((item) => item.text)).toEqual(['from the file', 'from the app']);
	});

	it('keeps markers that look different in the same second as separate glyphs', () => {
		builder.addMarkerPoint(
			1,
			{ dimName: 'price', timestamp: 2100 },
			{ icon: 'square', color: 'orange' }
		);
		builder.setInjectedMarkers([{ time: 2400, kind: 'sell' }]);
		expect(lastMarkers().map((marker) => marker.shape)).toEqual(['square', 'arrowDown']);
	});

	it('restores a toggled JSON marker without disturbing the injected ones', () => {
		builder.addMarkerPoint(1, { dimName: 'price', timestamp: 1000 }, { icon: 'square' });
		builder.setInjectedMarkers([{ time: 3000, kind: 'info' }]);
		builder.toggleMarkers(1, 'price', 'square');
		expect(lastMarkers().map((marker) => marker.time)).toEqual([3]);
		builder.toggleMarkers(1, 'price', 'square');
		expect(lastMarkers().map((marker) => marker.time)).toEqual([1, 3]);
	});
});
