import { describe, expect, it } from 'vitest';
import {
	formatPreciseValue,
	getPricePrecision,
	getSignificantPrecision
} from '../../src/lib/pricePrecision';

describe('getPricePrecision: clean values keep every decimal they have', () => {
	it('uses two decimals for integers and short prices', () => {
		expect(getPricePrecision([])).toBe(2);
		expect(getPricePrecision([1, 2, 3])).toBe(2);
		expect(getPricePrecision([100, 250000])).toBe(2);
		expect(getPricePrecision([69574.62, 68705.8])).toBe(2);
	});

	it('widens to the longest value', () => {
		expect(getPricePrecision([1.5, 1.234])).toBe(3);
		expect(getPricePrecision([null, 0.1235, 10])).toBe(4);
	});

	it('keeps eight-decimal crypto prices whatever their magnitude', () => {
		expect(getPricePrecision([0.12345678])).toBe(8);
		expect(getPricePrecision([0.00012345])).toBe(8);
		expect(getPricePrecision([69574.12345678])).toBe(8);
		expect(getPricePrecision([123456.12345678, 2])).toBe(8);
	});

	it('keeps very small prices', () => {
		expect(getPricePrecision([3.33e-6, 3.78e-6])).toBe(8);
		expect(getPricePrecision([0.0000024675805])).toBe(13);
		expect(getPricePrecision([1e-9])).toBe(9);
	});

	it('keeps up to 14 genuine significant digits', () => {
		expect(getPricePrecision([0.12345678901234])).toBe(14);
		expect(getPricePrecision([1234.123456789])).toBe(9);
	});

	it('ignores nulls and values that are not finite', () => {
		expect(getPricePrecision([null, Number.NaN, Infinity, -Infinity, 1.5])).toBe(2);
	});

	it('treats negatives like positives', () => {
		expect(getPricePrecision([-0.12345678])).toBe(8);
		expect(getPricePrecision([-(0.1 + 0.2)])).toBe(2);
	});
});

describe('getPricePrecision: floating-point noise does not widen the scale', () => {
	it('drops the noise of 0.1 + 0.2', () => {
		expect(0.1 + 0.2).toBe(0.30000000000000004);
		expect(getPricePrecision([0.1 + 0.2])).toBe(2);
		expect(getPricePrecision([0.1 + 0.2, 0.125])).toBe(3);
	});

	it('drops the noise of sums, products and ratios', () => {
		expect(getPricePrecision([69574.62 + 0.01])).toBe(2);
		expect(getPricePrecision([1.1 * 1.1])).toBe(2);
		expect(getPricePrecision([4.35 * 100])).toBe(2);
		expect(getPricePrecision([0.1 * 3, 0.7 + 0.1, 0.9999999999999999])).toBe(2);
	});

	it('drops noise accumulated over many operations', () => {
		let sum = 0;
		for (let i = 0; i < 1000; i++) sum += 0.1;
		expect(sum).not.toBe(100);
		expect(getPricePrecision([sum])).toBe(2);
	});

	it('keeps the decimals that are real next to noisy values', () => {
		expect(getPricePrecision([0.30000000000000004, 0.12345678])).toBe(8);
		expect(getPricePrecision([69574.12345678 + 0.1])).toBe(8);
		expect(getPricePrecision([3.71e-6 + 3.72e-6])).toBe(8);
	});

	it('stays correct when the answer is already covered by earlier values', () => {
		const values = [1.12345, 0.1 + 0.2, 2.1 + 0.2, 3.3000000000000003];
		expect(getPricePrecision(values)).toBe(5);
	});

	it('does not round away the representation error of 32-bit floats', () => {
		// Math.fround(0.1) is 0.10000000149011612: a real difference, not rounding noise.
		expect(getPricePrecision([Math.fround(0.1)])).toBeGreaterThan(8);
		expect(formatPreciseValue(Math.fround(0.1))).not.toBe('0.1');
	});
});

describe('getPricePrecision: the chart limit', () => {
	it('never exceeds 16 decimals', () => {
		expect(getPricePrecision([1.2e-18])).toBe(16);
		expect(getPricePrecision([1.2345678901234567e-5])).toBe(16);
		expect(getPricePrecision([0.0000024675805, 1.2e-18])).toBe(16);
	});

	it('does not throw on extreme values', () => {
		expect(getPricePrecision([1e21, 1e300, 5e-324, Number.MAX_VALUE, Number.MIN_VALUE])).toBe(16);
		expect(getPricePrecision([1e21, 1e300])).toBe(2);
	});
});

describe('formatPreciseValue', () => {
	it('shows a clean value as it is', () => {
		expect(formatPreciseValue(100.25)).toBe('100.25');
		expect(formatPreciseValue(0.00000385)).toBe('0.00000385');
		expect(formatPreciseValue(0)).toBe('0');
		expect(formatPreciseValue(42)).toBe('42');
		expect(formatPreciseValue(-69574.12345678)).toBe('-69574.12345678');
		expect(formatPreciseValue(1.2e-18)).toBe('0.0000000000000000012');
	});

	it('shows a noisy value without its noise', () => {
		expect(formatPreciseValue(0.1 + 0.2)).toBe('0.3');
		expect(formatPreciseValue(69574.62 + 0.01)).toBe('69574.63');
		expect(formatPreciseValue(1.1 * 1.1)).toBe('1.21');
		expect(formatPreciseValue(-(0.1 + 0.2))).toBe('-0.3');
	});

	it('rounds noise around a whole number to that number', () => {
		expect(formatPreciseValue(0.9999999999999999)).toBe('1');
		expect(formatPreciseValue(434.99999999999994)).toBe('435');
		expect(formatPreciseValue(-4.35 * 100)).toBe('-435');
	});

	it('leaves non-finite values and huge numbers alone', () => {
		expect(formatPreciseValue(Number.NaN)).toBe('NaN');
		expect(formatPreciseValue(Infinity)).toBe('Infinity');
		expect(formatPreciseValue(1e21)).toBe('1e+21');
	});
});

describe('getSignificantPrecision (unchanged)', () => {
	it('follows the largest magnitude', () => {
		expect(getSignificantPrecision([0.123456789])).toBe(5);
		expect(getSignificantPrecision([1234.56789, 2])).toBe(2);
		expect(getSignificantPrecision([])).toBe(2);
	});
});
