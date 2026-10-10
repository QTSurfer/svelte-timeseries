import { describe, expect, it, vi } from 'vitest';
import { tableFromArrays } from 'apache-arrow';
import { DuckDBTimeSeries } from '../../src/lib/duckdb/DuckDBTimeSeries';

function createArrowTable(columns: Record<string, unknown[]>) {
	const fieldNames = Object.keys(columns);
	return {
		schema: { fields: fieldNames.map((name) => ({ name })) },
		numRows: columns[fieldNames[0]]?.length ?? 0,
		getChild: vi.fn((name: string) => ({
			get: (index: number) => columns[name][index]
		}))
	};
}

async function* asBatches(table: ReturnType<typeof createArrowTable>) {
	yield table;
}

function createTimeSeries() {
	const queries = {
		query: vi.fn(),
		queryBatch: vi.fn()
	};
	const timeSeries = new DuckDBTimeSeries<{ prices: { url: string; mainColumn: string } }>(
		queries as never
	);
	return { queries, timeSeries };
}

describe('DuckDBTimeSeries sparse values', () => {
	it('keeps rows with null values in windowed columns', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(1000), new Date(2000), new Date(3000)],
				price: [10, 11, 12],
				ema: [null, null, 11]
			})
		);

		const result = await timeSeries.getWindowedData(
			'prices',
			['price', 'ema'],
			{ start: 1000, end: 3000 },
			100
		);

		expect(result).toEqual({
			_ts: [1000, 2000, 3000],
			price: [10, 11, 12],
			ema: [null, null, 11]
		});
		const sql = queries.query.mock.calls[0][0];
		expect(sql).not.toContain('"price" IS NOT NULL');
		expect(sql).not.toContain('"ema" IS NOT NULL');
	});

	it('keeps nulls when loading a single sparse dimension', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.queryBatch.mockResolvedValueOnce(
			asBatches(
				createArrowTable({
					_ts: [new Date(1000), new Date(2000), new Date(3000)],
					ema: [null, null, 11]
				})
			)
		);

		const result = await timeSeries.getSingleDimension('prices', 'ema', true);

		expect(result).toEqual({ ema: [null, null, 11] });
		const sql = queries.queryBatch.mock.calls[0][0];
		expect(sql).not.toContain('WHERE');
	});

	it('rejects null timestamps instead of converting them to zero', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.queryBatch.mockResolvedValueOnce(
			asBatches(
				createArrowTable({
					_ts: [null],
					ema: [11]
				})
			)
		);

		await expect(timeSeries.getSingleDimension('prices', 'ema', false)).rejects.toThrow(
			'Unexpected null timestamp in time-series data.'
		);
	});

	it('never converts missing OHLC values to zero', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.queryBatch.mockResolvedValueOnce(
			asBatches(
				createArrowTable({
					_ts: [new Date(1000), new Date(2000)],
					open: [null, 10],
					high: [12, 13],
					low: [9, null],
					close: [11, 12]
				})
			)
		);

		const result = await timeSeries.getOHLC('prices', {
			open: 'open',
			high: 'high',
			low: 'low',
			close: 'close'
		});

		expect(result.open).toEqual([null, 10]);
		expect(result.low).toEqual([9, null]);
	});
});

describe('DuckDBTimeSeries OHLC mode', () => {
	const ohlc = { open: 'opn', high: 'hig', low: 'low', close: 'cls' };

	it('resolves explicit, automatic, and disabled candlestick modes', () => {
		const { timeSeries } = createTimeSeries();
		const columns = ['_ts', 'opn', 'hig', 'low', 'cls'];

		expect(
			timeSeries.resolveOHLC('prices', columns, {
				url: '/prices.parquet',
				mainColumn: 'cls',
				candlestick: ohlc
			})
		).toEqual(ohlc);
		expect(
			timeSeries.resolveOHLC('prices', columns, {
				url: '/prices.parquet',
				mainColumn: 'cls'
			})
		).toEqual(ohlc);
		expect(
			timeSeries.resolveOHLC('prices', columns, {
				url: '/prices.parquet',
				mainColumn: 'cls',
				candlestick: false
			})
		).toBeUndefined();
	});

	it('aggregates complete boundary buckets before applying the point budget', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(60_000), new Date(120_000)],
				opn: [10, 20],
				hig: [15, 25],
				low: [8, 18],
				cls: [14, 24],
				ema: [13, 23]
			})
		);

		const result = await timeSeries.getWindowedOHLC(
			'prices',
			['opn', 'hig', 'low', 'cls', 'ema'],
			ohlc,
			'1m',
			{ start: 90_000, end: 130_000 },
			2
		);

		expect(result).toEqual({
			_ts: [60_000, 120_000],
			opn: [10, 20],
			hig: [15, 25],
			low: [8, 18],
			cls: [14, 24],
			ema: [13, 23]
		});
		const sql = queries.query.mock.calls[0][0];
		expect(sql).toContain('FIRST("opn" ORDER BY "_ts") AS "opn"');
		expect(sql).toContain('MAX("hig") AS "hig"');
		expect(sql).toContain('MIN("low") AS "low"');
		expect(sql).toContain('LAST("cls" ORDER BY "_ts") AS "cls"');
		expect(sql).toContain('LAST("ema" ORDER BY "_ts") AS "ema"');
		expect(sql).toContain('epoch_ms(90000)');
		expect(sql).toContain('epoch_ms(130000)');
		expect(sql).toContain("+ INTERVAL '1 minute'");
		expect(sql.indexOf('GROUP BY 1')).toBeLessThan(sql.indexOf('ROW_NUMBER() OVER'));
		expect(sql).toContain('__qts_sample_count <= 2');
	});

	it('uses raw aligned rows when no OHLC resolution is configured', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(1000)],
				opn: [10],
				hig: [12],
				low: [9],
				cls: [11]
			})
		);

		await timeSeries.getWindowedOHLC(
			'prices',
			['opn', 'hig', 'low', 'cls'],
			ohlc,
			undefined,
			{ start: 1000, end: 2000 },
			10
		);

		const sql = queries.query.mock.calls[0][0];
		expect(sql).not.toContain('time_bucket');
		expect(sql).toContain('"_ts" >= epoch_ms(1000)');
		expect(sql).toContain('"_ts" <= epoch_ms(2000)');
	});
});

describe('DuckDBTimeSeries ticker candles', () => {
	const ticker = ['_ts', 'opn', 'hig', 'low', 'cls', 'vol', 'bid', 'bsz', 'ask', 'asz'];
	const klines = ['_ts', 'opn', 'hig', 'low', 'cls', 'vol', 'ntr'];
	const config = { url: '/ticker.parquet', mainColumn: 'cls' } as const;
	const columns = { open: 'cls_open', high: 'cls_high', low: 'cls_low', close: 'cls' };

	it('never reports the open / high / low of a ticker feed as bar prices', () => {
		const { timeSeries } = createTimeSeries();

		expect(timeSeries.resolveOHLC('prices', ticker, config)).toBeUndefined();
		expect(
			timeSeries.resolveOHLC('prices', ticker, { ...config, resolution: '1m' })
		).toBeUndefined();
	});

	it('detects a ticker and aggregates its close column', () => {
		const { timeSeries } = createTimeSeries();

		expect(
			timeSeries.resolveTickCandles('prices', ticker, { ...config, resolution: '1m' })
		).toEqual({
			price: 'cls',
			columns,
			resolution: '1m',
			detected: true
		});
		expect(timeSeries.resolveTickCandles('prices', ticker, config)).toMatchObject({
			resolution: undefined
		});
	});

	it('leaves bar data alone', () => {
		const { timeSeries } = createTimeSeries();

		expect(timeSeries.resolveOHLC('prices', klines, config)).toEqual({
			open: 'opn',
			high: 'hig',
			low: 'low',
			close: 'cls'
		});
		expect(timeSeries.resolveTickCandles('prices', klines, config)).toBeUndefined();
	});

	it('honours an explicit mapping on a table that has quotes', () => {
		const { timeSeries } = createTimeSeries();
		const explicit = { open: 'opn', high: 'hig', low: 'low', close: 'cls' };

		expect(timeSeries.resolveOHLC('prices', ticker, { ...config, candlestick: explicit })).toEqual(
			explicit
		);
		expect(
			timeSeries.resolveTickCandles('prices', ticker, { ...config, candlestick: explicit })
		).toBeUndefined();
	});

	it('honours candlestick: false', () => {
		const { timeSeries } = createTimeSeries();

		expect(
			timeSeries.resolveTickCandles('prices', ticker, { ...config, candlestick: false })
		).toBeUndefined();
		expect(
			timeSeries.resolveOHLC('prices', ticker, { ...config, candlestick: false })
		).toBeUndefined();
	});

	it('lets a table without quotes ask for candles from a price column', () => {
		const { timeSeries } = createTimeSeries();
		const ticks = ['_ts', 'last', 'opn', 'hig', 'low'];
		const asked = {
			url: '/t.parquet',
			mainColumn: 'last',
			candlestick: { price: 'LAST' },
			resolution: '5s'
		} as const;

		expect(timeSeries.resolveTickCandles('prices', ticks, asked)).toEqual({
			price: 'last',
			columns: { open: 'last_open', high: 'last_high', low: 'last_low', close: 'last' },
			resolution: '5s',
			detected: false
		});
		expect(timeSeries.resolveOHLC('prices', ticks, asked)).toBeUndefined();
		expect(() =>
			timeSeries.resolveTickCandles('prices', ticks, {
				...asked,
				candlestick: { price: 'missing' }
			})
		).toThrowError(/price column "missing" not found/);
	});

	it('aggregates the price column in SQL and names the outputs without clashing with low', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.queryBatch.mockResolvedValueOnce(
			asBatches(
				createArrowTable({
					_ts: [new Date(60_000)],
					cls_open: [10],
					cls_high: [14],
					cls_low: [8],
					cls: [12]
				})
			)
		);

		const result = await timeSeries.getOHLC('prices', columns, '1m', 'cls');

		expect(result).toEqual({
			_ts: [60_000],
			cls_open: [10],
			cls_high: [14],
			cls_low: [8],
			cls: [12]
		});
		const sql = queries.queryBatch.mock.calls[0][0];
		expect(sql).toContain(`time_bucket(INTERVAL '1 minute', "_ts")`);
		expect(sql).toMatch(/FIRST\("cls" ORDER BY "_ts"\)\s+AS "cls_open"/);
		expect(sql).toMatch(/MAX\("cls"\)\s+AS "cls_high"/);
		expect(sql).toMatch(/MIN\("cls"\)\s+AS "cls_low"/);
		expect(sql).toMatch(/LAST\("cls" ORDER BY "_ts"\)\s+AS "cls"/);
		expect(sql).toContain('WHERE "cls" IS NOT NULL');
		expect(sql).not.toMatch(/"(opn|hig)"/);
	});

	it('aggregates the price column in viewport reloads', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(60_000)],
				cls_open: [10],
				cls_high: [14],
				cls_low: [8],
				cls: [12],
				bid: [11]
			})
		);

		await timeSeries.getWindowedOHLC(
			't',
			['cls_open', 'cls_high', 'cls_low', 'cls', 'bid'],
			columns,
			'1m',
			{ start: 90_000, end: 130_000 },
			500,
			'cls'
		);

		const sql = queries.query.mock.calls[0][0];
		expect(sql).toContain('FIRST("cls" ORDER BY "_ts") AS "cls_open"');
		expect(sql).toContain('MAX("cls") AS "cls_high"');
		expect(sql).toContain('MIN("cls") AS "cls_low"');
		expect(sql).toContain('LAST("cls" ORDER BY "_ts") AS "cls"');
		expect(sql).toContain('LAST("bid" ORDER BY "_ts") AS "bid"');
		expect(sql).toContain('AND "cls" IS NOT NULL');
		expect(sql.indexOf('GROUP BY 1')).toBeLessThan(sql.indexOf('ROW_NUMBER() OVER'));
		expect(sql).not.toContain('"opn"');
	});

	it('does not touch the SQL of bar data', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({ _ts: [new Date(60_000)], opn: [1], hig: [2], low: [0], cls: [1] })
		);

		await timeSeries.getWindowedOHLC(
			'k',
			['opn', 'hig', 'low', 'cls'],
			{ open: 'opn', high: 'hig', low: 'low', close: 'cls' },
			'1m',
			{ start: 0, end: 120_000 }
		);

		const sql = queries.query.mock.calls[0][0];
		expect(sql).toContain('FIRST("opn" ORDER BY "_ts") AS "opn"');
		expect(sql).not.toContain('IS NOT NULL');
	});

	it('refuses to aggregate a price column without a resolution', async () => {
		const { timeSeries } = createTimeSeries();

		await expect(timeSeries.getOHLC('prices', columns, undefined, 'cls')).rejects.toThrowError(
			/need a resolution/
		);
		await expect(
			timeSeries.getWindowedOHLC('t', ['cls'], columns, undefined, { start: 0, end: 1 }, 10, 'cls')
		).rejects.toThrowError(/need a resolution/);
	});
});

describe('DuckDBTimeSeries viewport conversion', () => {
	it.each([0, 1, 50])('resolves vectors once per column for %s rows', async (rowCount) => {
		const { queries, timeSeries } = createTimeSeries();
		const table = createArrowTable({
			_ts: Array.from({ length: rowCount }, (_, index) => BigInt(index * 1000)),
			price: Array.from({ length: rowCount }, (_, index) => index),
			ema: Array.from({ length: rowCount }, () => null)
		});
		queries.query.mockResolvedValueOnce(table);

		const result = await timeSeries.getWindowedData(
			'prices',
			['price', 'ema'],
			{ start: 0, end: 50_000 },
			50
		);

		expect(table.getChild.mock.calls).toEqual([['_ts'], ['price'], ['ema']]);
		expect(Object.keys(result)).toEqual(['_ts', 'price', 'ema']);
		expect(result._ts).toEqual(Array.from({ length: rowCount }, (_, index) => index * 1000));
		expect(result.price).toEqual(Array.from({ length: rowCount }, (_, index) => index));
		expect(result.ema).toEqual(Array.from({ length: rowCount }, () => null));
		expect(queries.queryBatch).not.toHaveBeenCalled();
	});

	it('preserves ordering and sparse values across Arrow record batches', async () => {
		const { queries, timeSeries } = createTimeSeries();
		const table = tableFromArrays({ _ts: [1000, 2000], price: [10, 20], ema: [null, 19] }).concat(
			tableFromArrays({ _ts: [3000, 4000], price: [30, 40], ema: [29, null] })
		);
		const getChild = vi.spyOn(table, 'getChild');
		queries.query.mockResolvedValueOnce(table);

		const result = await timeSeries.getWindowedData(
			'prices',
			['price', 'ema'],
			{ start: 1000, end: 4000 },
			10
		);

		expect(table.batches).toHaveLength(2);
		expect(result).toEqual({
			_ts: [1000, 2000, 3000, 4000],
			price: [10, 20, 30, 40],
			ema: [null, 19, 29, null]
		});
		expect(getChild.mock.calls).toEqual([['_ts'], ['price'], ['ema']]);
	});
});

describe('DuckDBTimeSeries point budgets', () => {
	it('samples the entire window without prefix truncation', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(1000), new Date(5000)],
				price: [10, 50]
			})
		);

		const result = await timeSeries.getWindowedData(
			'prices',
			['price'],
			{ start: 1000, end: 5000 },
			2
		);

		expect(result).toEqual({ _ts: [1000, 5000], price: [10, 50] });
		const sql = queries.query.mock.calls[0][0];
		expect(sql).toContain('WITH windowed AS');
		expect(sql).toContain('__qts_sample_row = 1');
		expect(sql).toContain('hash("_ts", "price")');
		expect(sql).not.toContain('LIMIT');
	});

	it('selects the middle row for a one-point budget', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(3000)],
				price: [30]
			})
		);

		await timeSeries.getWindowedData('prices', ['price'], { start: 1000, end: 5000 }, 1);

		expect(queries.query.mock.calls[0][0]).toContain(
			'__qts_sample_row = CAST(CEIL(__qts_sample_count / 2.0) AS BIGINT)'
		);
	});

	it('keeps smaller windows and duplicate timestamps aligned', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(
			createArrowTable({
				_ts: [new Date(1000), new Date(1000), new Date(2000)],
				price: [10, 11, 20],
				ema: [null, 10, 19]
			})
		);

		const result = await timeSeries.getWindowedData(
			'prices',
			['price', 'ema'],
			{ start: 1000, end: 2000 },
			5
		);

		expect(result).toEqual({
			_ts: [1000, 1000, 2000],
			price: [10, 11, 20],
			ema: [null, 10, 19]
		});
		expect(queries.query.mock.calls[0][0]).toContain('__qts_sample_count <= 5');
	});

	it('returns aligned empty columns for an empty window', async () => {
		const { queries, timeSeries } = createTimeSeries();
		queries.query.mockResolvedValueOnce(createArrowTable({ _ts: [], price: [] }));

		await expect(
			timeSeries.getWindowedData('prices', ['price'], { start: 1000, end: 2000 }, 5)
		).resolves.toEqual({ _ts: [], price: [] });
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid point budget %s',
		async (maxPoints) => {
			const { queries, timeSeries } = createTimeSeries();

			await expect(
				timeSeries.getWindowedData('prices', ['price'], { start: 1000, end: 2000 }, maxPoints)
			).rejects.toThrow('Point budget must be a finite positive integer.');
			expect(queries.query).not.toHaveBeenCalled();
		}
	);
});
