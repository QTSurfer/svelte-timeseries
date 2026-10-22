import { describe, expect, it } from 'vitest';
import { exactMinMove, priceFormatFor } from '../../src/lib/pricePrecision';

describe('exactMinMove', () => {
	it('makes minMove * 10 ** precision exactly 1 for every precision the chart accepts', () => {
		for (let precision = 0; precision <= 16; precision++) {
			expect(exactMinMove(precision) * Math.pow(10, precision), `precision ${precision}`).toBe(1);
		}
	});

	it('keeps 10 ** -precision wherever it already works, and stays within a few ulps elsewhere', () => {
		for (let precision = 0; precision <= 16; precision++) {
			const nominal = 10 ** -precision;
			const exact = exactMinMove(precision);
			if (nominal * Math.pow(10, precision) === 1) {
				expect(exact, `precision ${precision}`).toBe(nominal);
			} else {
				// 1e-11 * 1e11 is 0.9999999999999999 in V8: the cause of the garbled axis labels.
				expect(Math.abs(exact / nominal - 1), `precision ${precision}`).toBeLessThan(1e-15);
			}
		}
	});

	it('builds the price format with it', () => {
		expect(priceFormatFor(2)).toEqual({ type: 'price', precision: 2, minMove: 0.01 });
		expect(priceFormatFor(11)).toEqual({
			type: 'price',
			precision: 11,
			minMove: exactMinMove(11)
		});
	});
});
