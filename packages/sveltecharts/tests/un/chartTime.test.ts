import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TickMarkType } from 'lightweight-charts';
import {
	TICK_MARK_TYPE,
	formatChartClock,
	formatChartDateTime,
	lightweightTimeOptions
} from '../../src/lib/chartTime';

// Pinned to a zone without daylight saving (UTC-3), so the expectations hold on any machine:
// 14:41:14Z reads 11:41:14 here, and 03:00Z is midnight.
const ZONE = 'America/Argentina/Buenos_Aires';
const KOLKATA = 'Asia/Kolkata';
const instant = Date.UTC(2026, 10, 17, 14, 41, 14);
const seconds = (iso: string) => Date.parse(iso) / 1000;

const original = process.env.TZ;
const setZone = (zone: string | undefined) => {
	if (zone === undefined) delete process.env.TZ;
	else process.env.TZ = zone;
};
beforeEach(() => setZone(ZONE));
afterEach(() => setZone(original));

describe('TICK_MARK_TYPE', () => {
	it('has the values of the engine’s own enum, which this file does not import', () => {
		expect(TICK_MARK_TYPE).toEqual({
			Year: TickMarkType.Year,
			Month: TickMarkType.Month,
			DayOfMonth: TickMarkType.DayOfMonth,
			Time: TickMarkType.Time,
			TimeWithSeconds: TickMarkType.TimeWithSeconds
		});
	});
});

describe('formatChartClock', () => {
	it('is UTC unless the time zone is asked for', () => {
		expect(formatChartClock(instant)).toBe('14:41:14');
		expect(formatChartClock(instant, 'utc')).toBe('14:41:14');
	});

	it('reads the viewer’s clock for "local"', () => {
		expect(formatChartClock(instant, 'local')).toBe('11:41:14');
	});

	it('pads every field', () => {
		expect(formatChartClock(Date.UTC(2026, 0, 1, 3, 4, 5), 'utc')).toBe('03:04:05');
	});
});

describe('formatChartDateTime', () => {
	it('is UTC unless the time zone is asked for, in the format the tooltip always had', () => {
		expect(formatChartDateTime(instant)).toBe('2026-11-17 14:41:14');
		expect(formatChartDateTime(instant, 'utc')).toBe('2026-11-17 14:41:14');
	});

	it('writes the viewer’s date and clock for "local"', () => {
		expect(formatChartDateTime(instant, 'local')).toBe('2026-11-17 11:41:14');
	});

	it('follows the date over midnight, where UTC and the zone are on different days', () => {
		const early = Date.UTC(2026, 0, 1, 1, 30, 0);
		expect(formatChartDateTime(early, 'utc')).toBe('2026-01-01 01:30:00');
		expect(formatChartDateTime(early, 'local')).toBe('2025-12-31 22:30:00');
	});
});

describe('lightweightTimeOptions', () => {
	it('adds nothing for UTC, which is what the engine draws on its own', () => {
		expect(lightweightTimeOptions('utc')).toEqual({});
	});

	describe('local', () => {
		const options = lightweightTimeOptions('local');
		const tick = (time: number, type: TickMarkType, locale = 'en-GB') =>
			options.timeScale!.tickMarkFormatter(time as never, type, locale);

		it('labels the crosshair with the viewer’s date and clock', () => {
			expect(options.localization!.timeFormatter((instant / 1000) as never)).toBe(
				'2026-11-17 11:41:14'
			);
		});

		it('is empty for a time that is not a timestamp (only timestamps are drawn)', () => {
			expect(options.localization!.timeFormatter('2026-11-17' as never)).toBe('');
			expect(tick('2026-11-17' as never, TickMarkType.Time)).toBeNull();
		});

		it('labels a time tick with the local clock', () => {
			const time = seconds('2026-11-17T14:41:00Z');
			expect(tick(time, TickMarkType.Time)).toBe('11:41');
			expect(tick(seconds('2026-11-17T14:41:14Z'), TickMarkType.TimeWithSeconds)).toBe('11:41:14');
		});

		it('follows the zone it is built in at the time of the call, not at creation', () => {
			setZone(KOLKATA);
			expect(tick(seconds('2026-11-17T14:41:00Z'), TickMarkType.Time)).toBe('20:11');
		});

		it('names the day, month or year of a tick that is at the start of it in the local zone', () => {
			// 03:00Z is midnight in Buenos Aires.
			expect(tick(seconds('2026-11-17T03:00:00Z'), TickMarkType.DayOfMonth)).toBe('17');
			expect(tick(seconds('2026-11-01T03:00:00Z'), TickMarkType.Month)).toBe('Nov');
			expect(tick(seconds('2027-01-01T03:00:00Z'), TickMarkType.Year)).toBe('2027');
		});

		it('writes the clock, not a date, on a day tick that is not at local midnight', () => {
			// The engine puts its day ticks at midnight UTC, which is 21:00 of the day before here:
			// calling it "17" would put the start of a day three hours from where it is.
			const utcMidnight = seconds('2026-11-17T00:00:00Z');
			expect(tick(utcMidnight, TickMarkType.DayOfMonth)).toBe('21:00');
			expect(tick(utcMidnight, TickMarkType.Month)).toBe('21:00');
			expect(tick(seconds('2027-01-01T00:00:00Z'), TickMarkType.Year)).toBe('21:00');
		});

		it('does not call a local midnight the start of a month unless it is the first', () => {
			expect(tick(seconds('2026-11-17T03:00:00Z'), TickMarkType.Month)).toBe('00:00');
		});

		it('names the month in the locale the chart is given', () => {
			expect(tick(seconds('2026-03-01T03:00:00Z'), TickMarkType.Month, 'es')).toBe('mar');
		});
	});
});
