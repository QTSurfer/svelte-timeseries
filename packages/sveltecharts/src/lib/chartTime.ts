/**
 * The time zone the charts write their times in. Pure: it touches no chart instance.
 *
 * Chart time is UTC, and `'utc'` (the default everywhere) writes it as it is. `'local'` writes the
 * viewer's own clock instead, for an app whose other screens do the same.
 */
import type { TickMarkType, Time } from 'lightweight-charts';

export type ChartTimeZone = 'utc' | 'local';

type Fields = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

const fieldsOf = (epochMs: number, timeZone: ChartTimeZone): Fields => {
	const d = new Date(epochMs);
	return timeZone === 'utc'
		? {
				year: d.getUTCFullYear(),
				month: d.getUTCMonth() + 1,
				day: d.getUTCDate(),
				hour: d.getUTCHours(),
				minute: d.getUTCMinutes(),
				second: d.getUTCSeconds()
			}
		: {
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
				hour: d.getHours(),
				minute: d.getMinutes(),
				second: d.getSeconds()
			};
};

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

const clock = (f: Fields, withSeconds: boolean): string =>
	`${pad(f.hour)}:${pad(f.minute)}${withSeconds ? `:${pad(f.second)}` : ''}`;

/** `HH:MM:SS` of an instant (epoch milliseconds). */
export function formatChartClock(epochMs: number, timeZone: ChartTimeZone = 'utc'): string {
	return clock(fieldsOf(epochMs, timeZone), true);
}

/** `YYYY-MM-DD HH:MM:SS` of an instant (epoch milliseconds): the time a tooltip shows. */
export function formatChartDateTime(epochMs: number, timeZone: ChartTimeZone = 'utc'): string {
	const f = fieldsOf(epochMs, timeZone);
	return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)} ${clock(f, true)}`;
}

// The values of Lightweight Charts' `TickMarkType`. The enum is not imported as a value so that a chart
// that does not use that engine does not load it with this file; a test pins these to the engine's own.
export const TICK_MARK_TYPE = {
	Year: 0,
	Month: 1,
	DayOfMonth: 2,
	Time: 3,
	TimeWithSeconds: 4
} as const;

// The axis asks for the label of every tick at every zoom or pan, so the formatter of the month names
// is made once per locale.
const monthNames = new Map<string, Intl.DateTimeFormat>();
const monthName = (locale: string, epochMs: number): string => {
	let format = monthNames.get(locale);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, { month: 'short' });
		monthNames.set(locale, format);
	}
	return format.format(epochMs);
};

const isTimestamp = (time: Time): time is Time & number => typeof time === 'number';

/**
 * The label of a tick of the time axis, on the viewer's clock.
 *
 * The engine decides where to put a tick, and of what kind, on UTC boundaries: a "day" tick is at
 * midnight UTC, which for most viewers is not their midnight. Naming the day on it would put the
 * start of a day hours from where it is, so a tick is only named for its day, month or year when it
 * is at the start of one on the viewer's clock, and otherwise says what time it is.
 */
function localTickMark(time: Time, type: TickMarkType, locale: string): string | null {
	if (!isTimestamp(time)) return null;

	const epochMs = time * 1000;
	const f = fieldsOf(epochMs, 'local');
	const atMidnight = f.hour === 0 && f.minute === 0 && f.second === 0;
	const atMonthStart = atMidnight && f.day === 1;
	const atYearStart = atMonthStart && f.month === 1;

	switch (type) {
		case TICK_MARK_TYPE.Year:
			return atYearStart ? String(f.year) : clock(f, false);
		case TICK_MARK_TYPE.Month:
			return atMonthStart ? monthName(locale, epochMs) : clock(f, false);
		case TICK_MARK_TYPE.DayOfMonth:
			return atMidnight ? String(f.day) : clock(f, false);
		case TICK_MARK_TYPE.TimeWithSeconds:
			return clock(f, true);
		default:
			return clock(f, false);
	}
}

/** The part of Lightweight Charts' own options that holds the time formatters. */
export type LightweightTimeOptions = {
	timeScale?: {
		tickMarkFormatter: (time: Time, type: TickMarkType, locale: string) => string | null;
	};
	localization?: { timeFormatter: (time: Time) => string };
};

/**
 * The Lightweight Charts options that write the time axis and the crosshair label in `timeZone`.
 * Nothing for `'utc'`, which is what the engine draws on its own. Merged under the options an app
 * passes itself, so its own formatters win.
 */
export function lightweightTimeOptions(timeZone: ChartTimeZone): LightweightTimeOptions {
	if (timeZone === 'utc') return {};
	return {
		timeScale: { tickMarkFormatter: localTickMark },
		localization: {
			timeFormatter: (time: Time) =>
				isTimestamp(time) ? formatChartDateTime(time * 1000, 'local') : ''
		}
	};
}
