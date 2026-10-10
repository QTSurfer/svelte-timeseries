import type { InjectedMarker } from '$lib';

const round = (value: number) => Math.round(value * 100) / 100;

/** Small deterministic PRNG so the demo looks the same on every load. */
function mulberry32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export type DemoData = {
	times: Float64Array;
	open: Float64Array;
	high: Float64Array;
	low: Float64Array;
	close: Float64Array;
	ema: (number | null)[];
	rsi: (number | null)[];
	markers: InjectedMarker[];
};

export const DEMO_START = Date.UTC(2025, 9, 28, 14, 0, 0);

export function ema(values: ArrayLike<number>, period: number): (number | null)[] {
	const result: (number | null)[] = new Array(values.length).fill(null);
	const k = 2 / (period + 1);
	let previous = 0;
	for (let i = 0; i < values.length; i++) {
		if (i < period - 1) {
			previous += values[i];
			continue;
		}
		previous =
			i === period - 1 ? (previous + values[i]) / period : values[i] * k + previous * (1 - k);
		result[i] = previous;
	}
	return result;
}

export function rsi(values: ArrayLike<number>, period: number): (number | null)[] {
	const result: (number | null)[] = new Array(values.length).fill(null);
	let gain = 0;
	let loss = 0;
	for (let i = 1; i < values.length; i++) {
		const change = values[i] - values[i - 1];
		const up = Math.max(change, 0);
		const down = Math.max(-change, 0);
		if (i <= period) {
			gain += up;
			loss += down;
			if (i === period) {
				gain /= period;
				loss /= period;
				result[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
			}
			continue;
		}
		gain = (gain * (period - 1) + up) / period;
		loss = (loss * (period - 1) + down) / period;
		result[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
	}
	return result;
}

/** A random-walk price with its OHLC bars, an EMA, an RSI and about twenty markers. */
export function createDemoData(count = 600, intervalMs = 60_000, seed = 7): DemoData {
	const random = mulberry32(seed);
	const times = new Float64Array(count);
	const open = new Float64Array(count);
	const high = new Float64Array(count);
	const low = new Float64Array(count);
	const close = new Float64Array(count);

	let price = 100;
	for (let i = 0; i < count; i++) {
		const o = price;
		const c = round(o + (random() - 0.5) * 1.6);
		times[i] = DEMO_START + i * intervalMs;
		open[i] = o;
		close[i] = c;
		high[i] = round(Math.max(o, c) + random() * 0.5);
		low[i] = round(Math.min(o, c) - random() * 0.5);
		price = c;
	}

	const markers: InjectedMarker[] = [];
	for (let i = 30, n = 0; i < count - 10; i += Math.floor(count / 18), n++) {
		const kind = n % 3 === 2 ? 'info' : n % 2 === 0 ? 'buy' : 'sell';
		markers.push({
			time: times[i] + 250,
			kind,
			// Every other marker is anchored at an exact price, the others at the bar.
			...(n % 2 === 0 ? { price: close[i] } : {}),
			text:
				kind === 'info'
					? `Note ${n + 1}: volatility spike`
					: `${kind === 'buy' ? 'Buy' : 'Sell'} ${n + 1} at ${close[i].toFixed(2)}`
		});
	}

	// Three buys inside the same UTC second: merged into one glyph with a count, listed in full on hover.
	const crowded = Math.floor(count * 0.55);
	for (const offset of [100, 450, 800]) {
		markers.push({
			time: times[crowded] + offset,
			kind: 'buy',
			text: `Partial fill at +${offset} ms`
		});
	}
	// Different looks in one second are stacked on the bar instead.
	const stacked = Math.floor(count * 0.8);
	markers.push({ time: times[stacked] + 100, kind: 'sell', text: 'Stop hit' });
	markers.push({ time: times[stacked] + 300, kind: 'info', text: 'Position closed' });
	markers.push({ time: times[stacked] + 600, kind: 'buy', text: 'Re-entry' });

	const rsiValues = rsi(close, 14);

	// Markers can also belong to an injected series, here the RSI in its own pane.
	for (let i = 20, found = 0; i < count && found < 3; i++) {
		const value = rsiValues[i];
		if (value !== null && value < 35) {
			markers.push({
				time: times[i],
				kind: 'info',
				series: 'RSI 14',
				price: value,
				text: `RSI ${value.toFixed(1)} is oversold`
			});
			found++;
			i += 40;
		}
	}

	return { times, open, high, low, close, ema: ema(close, 20), rsi: rsiValues, markers };
}

/** One tick per second of a random-walk price, as an exchange feed would deliver them. */
export function createTicks(
	count = 3600,
	seed = 11
): { times: Float64Array; values: Float64Array } {
	const random = mulberry32(seed);
	const times = new Float64Array(count);
	const values = new Float64Array(count);
	let price = 100;
	for (let i = 0; i < count; i++) {
		price = round(price + (random() - 0.5) * 0.3);
		times[i] = DEMO_START + i * 1000;
		values[i] = price;
	}
	return { times, values };
}
