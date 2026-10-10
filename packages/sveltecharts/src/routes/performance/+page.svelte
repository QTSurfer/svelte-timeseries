<script lang="ts">
	// Harness for `scripts/measure-performance.mjs`: draws `TimeSeriesChart` with a synthetic price
	// of N points and exposes `window.__perf` so a script can time a mount and the updates after it.
	import { tick } from 'svelte';
	import { TimeSeriesChart } from '$lib';
	import type { InjectedSeries, PriceLineInput, TimeSeriesChartAdapter } from '$lib';

	type Backend = 'lightweight' | 'echarts';

	let backend = $state<Backend>('lightweight');
	let mounted = $state(false);
	let price = $state.raw<PriceLineInput | undefined>();
	let series = $state.raw<InjectedSeries[]>([]);
	let adapter: TimeSeriesChartAdapter | undefined;
	let onReady: (() => void) | undefined;

	const START = Date.UTC(2025, 0, 1);

	// One point per second (the Lightweight Charts time axis has a resolution of one second).
	function makeTimes(count: number) {
		return Float64Array.from({ length: count }, (_, i) => START + i * 1000);
	}

	// A seeded random walk, so every run draws the same data.
	function makeValues(count: number, seed: number, from = 0) {
		const values = new Float64Array(count);
		let state = seed;
		let value = 100;
		for (let i = 0; i < count; i++) {
			state = (state * 1664525 + 1013904223) % 4294967296;
			value += (state / 4294967296 - 0.5) * 0.5;
			values[i] = Math.round(value * 100) / 100 + from;
		}
		return values;
	}

	const nextFrames = () =>
		new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);

	// Lightweight Charts paints in the next frame. ECharts reports `rendered` after every frame it
	// draws (the first frame of a new chart is followed by the zoom-out to all the data), so the
	// picture is done when it has been quiet for a moment; the time of the last frame is the answer.
	type RenderedEmitter = { on(name: string, handler: () => void): void };
	let renderedAt = 0;

	async function painted(since: number) {
		await nextFrames();
		if (!(adapter as { ECharts?: unknown } | undefined)?.ECharts) return performance.now();
		const limit = performance.now() + 20_000;
		while (
			performance.now() < limit &&
			!(renderedAt >= since && performance.now() - renderedAt > 250)
		) {
			await nextFrames();
		}
		return renderedAt;
	}

	function heap() {
		const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
		return memory ? memory.usedJSHeapSize : null;
	}

	function collect() {
		(window as unknown as { gc?: () => void }).gc?.();
	}

	// `allocated` is the heap growth right after the update was applied, measured from a collected
	// heap: what the update itself allocated and kept or left as garbage, close to its peak.
	async function timed(change: () => void) {
		await nextFrames();
		collect();
		const before = heap();
		const start = performance.now();
		change();
		await tick();
		const apply = performance.now() - start;
		const after = heap();
		return {
			apply,
			paint: (await painted(start)) - start,
			allocated: before === null || after === null ? null : after - before
		};
	}

	const api = {
		async mount(chart: Backend, count: number) {
			backend = chart;
			price = { name: 'price', times: makeTimes(count), values: makeValues(count, 1) };
			series = [];
			await nextFrames();
			collect();
			const before = heap();
			const start = performance.now();
			const ready = new Promise<void>((resolve) => (onReady = resolve));
			mounted = true;
			await ready;
			const created = performance.now() - start;
			const after = heap();
			return {
				created,
				paint: (await painted(start)) - start,
				allocated: before === null || after === null ? null : after - before
			};
		},
		async unmount() {
			mounted = false;
			adapter = undefined;
			await tick();
			await nextFrames();
		},
		addSeries(count: number) {
			const line = { name: 'EMA', times: makeTimes(count), values: makeValues(count, 2, 1) };
			return timed(() => (series = [line]));
		},
		replaceSeries(count: number, seed: number) {
			const line = { name: 'EMA', times: makeTimes(count), values: makeValues(count, seed, 1) };
			return timed(() => (series = [line]));
		},
		removeSeries() {
			return timed(() => (series = []));
		},
		// There is no append call: new arrays are handed over. Building them is not part of the time.
		append(count: number, extra: number) {
			const length = count + extra;
			const times = makeTimes(length);
			const next: PriceLineInput = { name: 'price', times, values: makeValues(length, 1) };
			const line = { name: 'EMA', times, values: makeValues(length, 2, 1) };
			return timed(() => {
				price = next;
				series = [line];
			});
		},
		revert(count: number) {
			const times = makeTimes(count);
			price = { name: 'price', times, values: makeValues(count, 1) };
			series = [{ name: 'EMA', times, values: makeValues(count, 2, 1) }];
			return nextFrames();
		},
		heap,
		gc: collect
	};
	(globalThis as unknown as { __perf: typeof api }).__perf = api;
</script>

<div style="width: 1200px; height: 600px">
	{#if mounted}
		<TimeSeriesChart
			chartLibrary={backend}
			{price}
			injectedSeries={series}
			onChartReady={(chart) => {
				adapter = chart;
				(chart as { ECharts?: RenderedEmitter }).ECharts?.on('rendered', () => {
					renderedAt = performance.now();
				});
				onReady?.();
			}}
		/>
	{/if}
</div>
