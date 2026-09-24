import { describe, expect, it, vi } from 'vitest';
import TimeSeriesFacade from '../../src/lib/TimeSeriesFacade';
import { VelaTimeSeriesChartBuilder } from '@qtsurfer/sveltecharts';

// VelaTimeSeriesChartBuilder registers a native-indicator type with @luxalgo/vela on
// construction (see its module-level ensureOverlayRegistered) — mocked here the same way
// tests/un/VelaTimeSeriesChartBuilder.test.ts does, so a mock Vela chart instance can be
// constructed without pulling in the real (heavy) Vela renderer.
let registeredDescriptor: { create: () => { start: (ctx: unknown) => void } } | null = null;

vi.mock('@luxalgo/vela', () => ({
	registerNativeIndicator: vi.fn((descriptor) => {
		registeredDescriptor = descriptor;
	})
}));

function createMockVelaChart() {
	let visibleRange: { from: number; to: number } | null = { from: 1000, to: 3000 };
	return {
		setMarket: vi.fn(),
		getVisibleRange: vi.fn(() => visibleRange),
		setVisibleRange: vi.fn((range: { from: number; to: number }) => {
			visibleRange = range;
		}),
		addNativeIndicator: vi.fn(() => {
			registeredDescriptor?.create();
			return { id: 'native-1' };
		})
	};
}

type ViewportData = { _ts: number[]; price: number[] };
type ChartData = Record<string, (number | null)[]>;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

function createChartAdapter() {
	const adapter: Record<string, any> = {};
	const activeDimensions = ['price'];
	for (const method of [
		'setLegendIcon',
		'setDataset',
		'setCandlestickSeries',
		'build',
		'addDimension',
		'addMarkerPoint',
		'toggleLegend',
		'goToZoom',
		'scrollToTime',
		'toggleMarkers',
		'clearMarkers',
		'updateDimension',
		'updateDimensions',
		'setDataRange'
	]) {
		adapter[method] = vi.fn(() => adapter);
	}
	adapter.addDimension = vi.fn((_data, dimension: string) => {
		if (!activeDimensions.includes(dimension)) activeDimensions.push(dimension);
		return adapter;
	});
	adapter.getRangeValues = vi.fn(() => [1000, 5000]);
	adapter.getActiveDimensions = vi.fn(() => [...activeDimensions]);
	adapter.getLoadedDimensions = vi.fn(() => [...activeDimensions]);
	adapter.getLegendStatus = vi.fn(() => ({ price: true }));
	adapter.getTotalRows = vi.fn(() => 3);
	return adapter;
}

function createDuckDB() {
	return {
		resolveOHLC: vi.fn<
			() => { open: string; high: string; low: string; close: string } | undefined
		>(() => undefined),
		getSingleDimension: vi.fn(
			async (_table: string, column: string, omitTimestamp: boolean): Promise<ChartData> =>
				omitTimestamp ? { [column]: [1, 2, 3] } : { _ts: [1000, 3000, 5000], [column]: [1, 2, 3] }
		),
		getWindowedData: vi.fn(
			async (
				_table: string,
				_columns: string[],
				_range: { start: number; end: number },
				_limit?: number
			): Promise<ChartData> => ({ _ts: [2000, 4000], price: [2, 3] })
		),
		getWindowedOHLC: vi.fn(
			async (): Promise<ChartData> => ({
				_ts: [2000, 4000],
				open: [10, 11],
				high: [12, 13],
				low: [9, 10],
				close: [11, 12]
			})
		),
		getTable: vi.fn<() => { resolution?: '1m' }>(() => ({ resolution: undefined })),
		getOHLC: vi.fn(
			async (): Promise<ChartData> => ({
				_ts: [1000, 3000, 5000],
				open: [10, 11, 12],
				high: [12, 13, 14],
				low: [9, 10, 11],
				close: [11, 12, 13]
			})
		)
	};
}

describe('TimeSeriesFacade viewport loading', () => {
	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid maxPoints setting %s',
		(maxPoints) => {
			const facade = new TimeSeriesFacade(createDuckDB() as never, createChartAdapter() as never);

			expect(() => facade.setViewportSettings({ maxPoints })).toThrow(
				'maxPoints must be a finite positive integer.'
			);
		}
	);

	it('accepts a one-point viewport budget', async () => {
		const duckDb = createDuckDB();
		const facade = new TimeSeriesFacade(duckDb as never, createChartAdapter() as never);
		await facade.initialize('prices', 'price');

		facade.setViewportSettings({ maxPoints: 1 });
		await facade.onViewportChange(1000, 2000);

		expect(duckDb.getWindowedData).toHaveBeenCalledWith(
			'prices',
			['price'],
			{ start: 1000, end: 2000 },
			1
		);
	});

	it('maps zoom percentages against the full dataset range', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		await facade.onViewportPercentageChange(25, 75);

		expect(adapter.setDataRange).toHaveBeenCalledWith(1000, 5000);
		expect(duckDb.getWindowedData).toHaveBeenCalledWith(
			'prices',
			['price'],
			{ start: 2000, end: 4000 },
			500000
		);
	});

	it('ignores a stale viewport response that finishes last', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		let resolveFirst!: (data: ViewportData) => void;
		let resolveSecond!: (data: ViewportData) => void;
		duckDb.getWindowedData
			.mockImplementationOnce(
				() => new Promise<ViewportData>((resolve) => (resolveFirst = resolve))
			)
			.mockImplementationOnce(
				() => new Promise<ViewportData>((resolve) => (resolveSecond = resolve))
			);

		const first = facade.onViewportChange(1000, 2000);
		const second = facade.onViewportChange(2000, 3000);
		resolveSecond({ _ts: [2500], price: [20] });
		await second;
		resolveFirst({ _ts: [1500], price: [10] });
		await first;

		expect(adapter.updateDimensions).toHaveBeenCalledTimes(1);
		expect(adapter.updateDimensions).toHaveBeenCalledWith({ _ts: [2500], price: [20] }, ['price']);
	});

	it('invalidates a pending viewport response when returning to the loaded range', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		await facade.onViewportChange(1000, 2000);
		adapter.updateDimensions.mockClear();

		const pending = deferred<ViewportData>();
		duckDb.getWindowedData.mockImplementationOnce(() => pending.promise);

		const moveAway = facade.onViewportChange(2000, 3000);
		await facade.onViewportChange(1000, 2000);
		pending.resolve({ _ts: [2500], price: [20] });
		await moveAway;

		expect(adapter.updateDimensions).not.toHaveBeenCalled();
		await facade.onViewportChange(2000, 3000);
		expect(duckDb.getWindowedData).toHaveBeenCalledTimes(3);
	});

	it('invalidates pending viewport work when initializing another table', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		const pending = deferred<ViewportData>();
		duckDb.getWindowedData.mockImplementationOnce(() => pending.promise);
		const oldViewport = facade.onViewportChange(1000, 2000);

		await facade.initialize('trades', 'price');
		adapter.updateDimensions.mockClear();
		pending.resolve({ _ts: [1500], price: [10] });
		await oldViewport;

		expect(adapter.updateDimensions).not.toHaveBeenCalled();
	});

	it('clears the loaded viewport range when initializing another table', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		await facade.onViewportChange(1000, 2000);

		await facade.initialize('trades', 'price');
		await facade.onViewportChange(1000, 2000);

		expect(duckDb.getWindowedData).toHaveBeenCalledTimes(2);
		expect(duckDb.getWindowedData).toHaveBeenLastCalledWith(
			'trades',
			['price'],
			{ start: 1000, end: 2000 },
			500000
		);
	});

	it('does not cache a rejected viewport range', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		duckDb.getWindowedData.mockRejectedValueOnce(new Error('query failed'));
		await expect(facade.onViewportChange(1000, 2000)).rejects.toThrow('query failed');
		await facade.onViewportChange(1000, 2000);

		expect(duckDb.getWindowedData).toHaveBeenCalledTimes(2);
		expect(adapter.updateDimensions).toHaveBeenCalledTimes(1);
	});

	it('ignores invalid viewport input without invalidating valid pending work', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		const pending = deferred<ViewportData>();
		duckDb.getWindowedData.mockImplementationOnce(() => pending.promise);
		const validViewport = facade.onViewportChange(1000, 2000);

		await facade.onViewportChange(Number.NaN, 2000);
		pending.resolve({ _ts: [1500], price: [10] });
		await validViewport;

		expect(duckDb.getWindowedData).toHaveBeenCalledTimes(1);
		expect(adapter.updateDimensions).toHaveBeenCalledWith({ _ts: [1500], price: [10] }, ['price']);
	});

	it('loads a lazy dimension from the current viewport instead of the full history', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		await facade.onViewportChange(2000, 3000);

		duckDb.getWindowedData.mockResolvedValueOnce({
			_ts: [2000, 3000],
			price: [20, 30],
			ema: [19, 29]
		});
		await facade.addDimension('prices', 'ema');

		expect(duckDb.getSingleDimension).toHaveBeenCalledTimes(1);
		expect(duckDb.getWindowedData).toHaveBeenLastCalledWith(
			'prices',
			['price', 'ema'],
			{ start: 2000, end: 3000 },
			500000
		);
		expect(adapter.addDimension).toHaveBeenCalledWith({ ema: [19, 29] }, 'ema');
		expect(adapter.updateDimensions).toHaveBeenLastCalledWith(
			{ _ts: [2000, 3000], price: [20, 30], ema: [19, 29] },
			['price']
		);
	});

	it('preserves full-history lazy loading before a viewport is requested', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		duckDb.getSingleDimension.mockResolvedValueOnce({ ema: [9, 19, 29] });

		await facade.addDimension('prices', 'ema');

		expect(duckDb.getSingleDimension).toHaveBeenLastCalledWith('prices', 'ema', true);
		expect(duckDb.getWindowedData).not.toHaveBeenCalled();
		expect(adapter.addDimension).toHaveBeenCalledWith({ ema: [9, 19, 29] }, 'ema');
	});

	it('keeps a lazy dimension when an older viewport request resolves last', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		await facade.onViewportChange(1000, 2000);
		adapter.addDimension.mockClear();
		adapter.updateDimensions.mockClear();

		const viewportRequest = deferred<ViewportData>();
		const dimensionRequest = deferred<ViewportData & { ema: number[] }>();
		duckDb.getWindowedData.mockImplementation((_table, columns) =>
			columns.includes('ema') ? dimensionRequest.promise : viewportRequest.promise
		);
		duckDb.getSingleDimension.mockImplementationOnce(() => dimensionRequest.promise);

		const viewport = facade.onViewportChange(2000, 3000);
		const dimension = facade.addDimension('prices', 'ema');
		dimensionRequest.resolve({ _ts: [2000, 3000], price: [20, 30], ema: [19, 29] });
		await dimension;
		viewportRequest.resolve({ _ts: [2000, 3000], price: [200, 300] });
		await viewport;

		expect(adapter.addDimension).toHaveBeenCalledOnce();
		expect(adapter.updateDimensions).toHaveBeenCalledOnce();
		expect(adapter.updateDimensions).toHaveBeenCalledWith(
			{ _ts: [2000, 3000], price: [20, 30], ema: [19, 29] },
			['price']
		);
	});

	it('uses a newer viewport when an older lazy-dimension request resolves last', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');
		await facade.onViewportChange(1000, 2000);
		adapter.addDimension.mockClear();
		adapter.updateDimensions.mockClear();

		const dimensionRequest = deferred<ViewportData & { ema: number[] }>();
		const viewportRequest = deferred<ViewportData & { ema: number[] }>();
		duckDb.getWindowedData.mockImplementation((_table, columns, range) => {
			if (range.start === 1000 && columns.includes('ema')) return dimensionRequest.promise;
			return viewportRequest.promise;
		});
		duckDb.getSingleDimension.mockImplementationOnce(() => dimensionRequest.promise);

		const dimension = facade.addDimension('prices', 'ema');
		const viewport = facade.onViewportChange(2000, 3000);
		viewportRequest.resolve({ _ts: [2000, 3000], price: [20, 30], ema: [19, 29] });
		await viewport;
		dimensionRequest.resolve({ _ts: [1000, 2000], price: [10, 20], ema: [9, 19] });
		await dimension;

		expect(adapter.addDimension).toHaveBeenCalledOnce();
		expect(adapter.updateDimensions).toHaveBeenCalledOnce();
		expect(adapter.updateDimensions).toHaveBeenCalledWith(
			{ _ts: [2000, 3000], price: [20, 30], ema: [19, 29] },
			['price']
		);
	});

	it('refreshes hidden loaded dimensions without changing their visibility', async () => {
		const duckDb = createDuckDB();
		const adapter = createChartAdapter();
		adapter.getLoadedDimensions.mockReturnValue(['price', 'ema']);
		adapter.getActiveDimensions.mockReturnValue(['price']);
		adapter.getLegendStatus.mockReturnValue({ price: true, ema: false });
		duckDb.getWindowedData.mockResolvedValueOnce({
			_ts: [2000, 3000],
			price: [20, 30],
			ema: [null, 29]
		});
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'price');

		await facade.onViewportChange(2000, 3000);

		expect(duckDb.getWindowedData).toHaveBeenCalledWith(
			'prices',
			['price', 'ema'],
			{ start: 2000, end: 3000 },
			500000
		);
		expect(adapter.updateDimensions).toHaveBeenCalledWith(
			{ _ts: [2000, 3000], price: [20, 30], ema: [null, 29] },
			['price', 'ema']
		);
		expect(adapter.getLegendStatus()).toEqual({ price: true, ema: false });
	});

	it('loads every OHLC source column behind the candlestick legend', async () => {
		const duckDb = createDuckDB();
		const ohlc = { open: 'open', high: 'high', low: 'low', close: 'close' };
		duckDb.resolveOHLC.mockReturnValue(ohlc);
		duckDb.getWindowedOHLC.mockResolvedValueOnce({
			_ts: [2000, 3000],
			open: [11, 12],
			high: [13, 14],
			low: [10, 11],
			close: [12, 13]
		});
		const adapter = createChartAdapter();
		adapter.getLoadedDimensions.mockReturnValue(['open', 'high', 'low', 'close']);
		adapter.getLegendStatus.mockReturnValue({ Candlestick: true });
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'close');

		await facade.onViewportChange(2000, 3000);

		expect(duckDb.getWindowedOHLC).toHaveBeenCalledWith(
			'prices',
			['open', 'high', 'low', 'close'],
			ohlc,
			undefined,
			{ start: 2000, end: 3000 },
			500000
		);
		expect(adapter.updateDimensions).toHaveBeenCalledWith(
			{
				_ts: [2000, 3000],
				open: [11, 12],
				high: [13, 14],
				low: [10, 11],
				close: [12, 13]
			},
			['open', 'high', 'low', 'close']
		);
	});

	it('preserves configured OHLC resolution during viewport reloads', async () => {
		const duckDb = createDuckDB();
		const ohlc = { open: 'opn', high: 'hig', low: 'low', close: 'cls' };
		duckDb.resolveOHLC.mockReturnValue(ohlc);
		duckDb.getTable.mockReturnValue({ resolution: '1m' });
		const adapter = createChartAdapter();
		adapter.getLoadedDimensions.mockReturnValue(['opn', 'hig', 'low', 'cls']);
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('prices', 'cls');

		await facade.onViewportChange(90_000, 150_000);

		expect(duckDb.getWindowedOHLC).toHaveBeenCalledWith(
			'prices',
			['opn', 'hig', 'low', 'cls'],
			ohlc,
			'1m',
			{ start: 90_000, end: 150_000 },
			500000
		);
		expect(duckDb.getWindowedData).not.toHaveBeenCalled();
	});

	it('returns to line viewport loading after initializing a non-OHLC table', async () => {
		const duckDb = createDuckDB();
		duckDb.resolveOHLC
			.mockReturnValueOnce({ open: 'open', high: 'high', low: 'low', close: 'close' })
			.mockReturnValueOnce(undefined);
		const adapter = createChartAdapter();
		const facade = new TimeSeriesFacade(duckDb as never, adapter as never);
		await facade.initialize('candles', 'close');
		await facade.initialize('prices', 'price');

		await facade.onViewportChange(2000, 3000);

		expect(duckDb.getWindowedOHLC).not.toHaveBeenCalled();
		expect(duckDb.getWindowedData).toHaveBeenCalledWith(
			'prices',
			['price'],
			{ start: 2000, end: 3000 },
			500000
		);
	});

	it('rejects a non-OHLC table when the chart builder is Vela', async () => {
		const duckDb = createDuckDB();
		duckDb.resolveOHLC.mockReturnValue(undefined);
		const velaChart = createMockVelaChart();
		const builder = new VelaTimeSeriesChartBuilder(velaChart as never);
		const facade = new TimeSeriesFacade(duckDb as never, builder);

		await expect(facade.initialize('prices', 'price')).rejects.toThrow(
			/Vela chart engine only supports candlestick data/
		);
		expect(velaChart.setMarket).not.toHaveBeenCalled();
	});

	it('lets Vela initialize normally against an OHLC table', async () => {
		const duckDb = createDuckDB();
		const ohlc = { open: 'open', high: 'high', low: 'low', close: 'close' };
		duckDb.resolveOHLC.mockReturnValue(ohlc);
		const velaChart = createMockVelaChart();
		const builder = new VelaTimeSeriesChartBuilder(velaChart as never);
		const facade = new TimeSeriesFacade(duckDb as never, builder);

		await expect(facade.initialize('candles', 'close')).resolves.toBeUndefined();
		expect(velaChart.setMarket).toHaveBeenCalledTimes(1);
	});

	it('adds an extra column onto a Vela candlestick chart', async () => {
		// Vela's overlay native indicator (see VelaTimeSeriesChartBuilder) lets addDimension
		// add extra line series (e.g. an EMA overlay) on top of an already-loaded candlestick
		// chart — toggleColumn must resolve normally instead of throwing.
		const duckDb = createDuckDB();
		const ohlc = { open: 'open', high: 'high', low: 'low', close: 'close' };
		duckDb.resolveOHLC.mockReturnValue(ohlc);
		const velaChart = createMockVelaChart();
		const builder = new VelaTimeSeriesChartBuilder(velaChart as never);
		const facade = new TimeSeriesFacade(duckDb as never, builder);
		await facade.initialize('candles', 'close');

		await facade.addDimension('candles', 'ema');

		expect(builder.getLoadedDimensions()).toContain('ema');
		expect(builder.getLegendStatus()).toHaveProperty('ema', true);
	});

	describe('isOHLCMode', () => {
		it('is false before initialize has run', () => {
			const facade = new TimeSeriesFacade(createDuckDB() as never, createChartAdapter() as never);
			expect(facade.isOHLCMode()).toBe(false);
		});

		it('is true after initializing a table that resolves to OHLC', async () => {
			const duckDb = createDuckDB();
			duckDb.resolveOHLC.mockReturnValue({
				open: 'open',
				high: 'high',
				low: 'low',
				close: 'close'
			});
			const facade = new TimeSeriesFacade(duckDb as never, createChartAdapter() as never);

			await facade.initialize('candles', 'close');

			expect(facade.isOHLCMode()).toBe(true);
		});

		it('is false after initializing a non-OHLC table', async () => {
			const duckDb = createDuckDB();
			duckDb.resolveOHLC.mockReturnValue(undefined);
			const facade = new TimeSeriesFacade(duckDb as never, createChartAdapter() as never);

			await facade.initialize('prices', 'price');

			expect(facade.isOHLCMode()).toBe(false);
		});

		it('flips back to false when a later table is not OHLC', async () => {
			const duckDb = createDuckDB();
			duckDb.resolveOHLC
				.mockReturnValueOnce({ open: 'open', high: 'high', low: 'low', close: 'close' })
				.mockReturnValueOnce(undefined);
			const facade = new TimeSeriesFacade(duckDb as never, createChartAdapter() as never);

			await facade.initialize('candles', 'close');
			expect(facade.isOHLCMode()).toBe(true);

			await facade.initialize('prices', 'price');
			expect(facade.isOHLCMode()).toBe(false);
		});
	});
});
