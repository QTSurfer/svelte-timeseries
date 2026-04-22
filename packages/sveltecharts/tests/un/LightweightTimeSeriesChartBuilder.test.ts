import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LightweightTimeSeriesChartBuilder,
	formatPreciseValue
} from '../../src/lib/LightweightTimeSeriesChartBuilder';

function createMockSeries() {
	return {
		setData: vi.fn(),
		applyOptions: vi.fn()
	};
}

function createMockChart() {
	const visibleLogicalRange = { from: 0, to: 10 };
	const timeScale = {
		getVisibleLogicalRange: vi.fn(() => visibleLogicalRange),
		setVisibleLogicalRange: vi.fn(),
		setVisibleRange: vi.fn(),
		fitContent: vi.fn()
	};

	return {
		addSeries: vi.fn(() => createMockSeries()),
		removeSeries: vi.fn(),
		applyOptions: vi.fn(),
		timeScale: vi.fn(() => timeScale)
	};
}

vi.mock('lightweight-charts', () => ({
	LineSeries: Symbol('LineSeries'),
	createSeriesMarkers: vi.fn(() => ({
		setMarkers: vi.fn(),
		detach: vi.fn()
	}))
}));

describe('LightweightTimeSeriesChartBuilder', () => {
	let chart: ReturnType<typeof createMockChart>;
	let builder: LightweightTimeSeriesChartBuilder;

	beforeEach(() => {
		chart = createMockChart();
		builder = new LightweightTimeSeriesChartBuilder(chart as never);
	});

	it('accepts simple object datasets and builds the chart', () => {
		const result = builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		expect(result).toBe(builder);
		expect(chart.addSeries).toHaveBeenCalledTimes(1);
		expect(builder.getRangeValues()).toEqual([1000, 3000]);
		expect(builder.getLegendStatus()).toEqual({ price: true });
	});

	it('configures price precision for very small values', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [0.00000385, 0.00000386, 0.00000387]
		});

		expect(chart.addSeries).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				priceFormat: {
					type: 'price',
					precision: 8,
					minMove: 0.00000001
				}
			})
		);
		expect(formatPreciseValue(0.00000385)).toBe('0.00000385');
	});

	it('adds dimensions incrementally and marks them as visible', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.addDimension(
			{
				ema: [99, 100, 101]
			},
			'ema'
		);

		expect(chart.addSeries).toHaveBeenCalledTimes(2);
		expect(builder.getLegendStatus()).toEqual({ price: true, ema: true });
	});

	it('toggles series visibility', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.toggleLegend('price');

		expect(builder.getLegendStatus()).toEqual({ price: false });
	});

	it('maps zoom percentages to visible time range', () => {
		builder.setDataset({
			_ts: [1000, 2000, 3000],
			price: [100, 101, 102]
		});

		builder.goToZoom(25, 75);

		const timeScale = chart.timeScale();
		expect(timeScale.setVisibleRange).toHaveBeenCalledWith({
			from: 1,
			to: 2
		});
	});
});
