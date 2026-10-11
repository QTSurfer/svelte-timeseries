<script lang="ts">
	// Harness for `scripts/measure-performance.mjs`: draws `TimeSeriesChart` with a synthetic price
	// of N points and exposes `window.__perf` so a script can time a mount and the updates after it.
	import { tick } from 'svelte';
	import { TimeSeriesChart } from '$lib';
	import DemoNav from '../DemoNav.svelte';
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

	// A panel for trying the same calls by hand. The script uses `window.__perf` directly.
	const SIZES = [10_000, 50_000, 100_000, 250_000];
	let chosenBackend = $state<Backend>('lightweight');
	let points = $state(100_000);
	let mountedPoints = $state(0);
	let busy = $state(false);
	let log = $state<string[]>([]);

	type Result = { created?: number; apply?: number; paint: number; allocated: number | null };
	const ms = (value: number) => `${value.toFixed(1)} ms`;
	const describe = ({ created, apply, paint, allocated }: Result) =>
		[
			created === undefined ? undefined : `created ${ms(created)}`,
			apply === undefined ? undefined : `apply ${ms(apply)}`,
			`paint ${ms(paint)}`,
			allocated === null ? undefined : `allocated ${(allocated / 1_048_576).toFixed(1)} MB`
		]
			.filter(Boolean)
			.join(', ');

	async function run(label: string, action: () => Promise<Result | void>) {
		busy = true;
		try {
			const result = await action();
			log = [`${label}: ${result ? describe(result) : 'done'}`, ...log].slice(0, 12);
		} finally {
			busy = false;
		}
	}

	const mount = () =>
		run(`mount ${chosenBackend} ${points.toLocaleString()} points`, async () => {
			// As the script does: a new chart starts from nothing, so the time is the cost of a mount.
			if (mounted) await api.unmount();
			const result = await api.mount(chosenBackend, points);
			mountedPoints = points;
			return result;
		});
	const unmount = () =>
		run('unmount', async () => {
			await api.unmount();
			mountedPoints = 0;
		});
</script>

<DemoNav current="/performance" />

<div class="panel" data-testid="panel">
	<p>
		Times how long a chart takes to draw a price of N points and to apply updates after it. Pick a
		backend and a size, press <b>Mount</b>, then try the updates.
		<code>scripts/measure-performance.mjs</code>
		drives the same calls through <code>window.__perf</code>. The allocated heap needs Chrome
		started with <code>--enable-precise-memory-info</code> and <code>--expose-gc</code>, as the
		script does; otherwise it reads 0.
	</p>
	<div class="controls">
		<label>
			Backend
			<select data-testid="backend" bind:value={chosenBackend} disabled={busy}>
				<option value="lightweight">Lightweight Charts</option>
				<option value="echarts">ECharts</option>
			</select>
		</label>
		<label>
			Points
			<select data-testid="points" bind:value={points} disabled={busy}>
				{#each SIZES as size (size)}
					<option value={size}>{size.toLocaleString()}</option>
				{/each}
			</select>
		</label>
		<button data-testid="mount" onclick={mount} disabled={busy}>Mount</button>
		<button data-testid="unmount" onclick={unmount} disabled={busy || !mounted}>Unmount</button>
		<span class="separator"></span>
		<button
			data-testid="add-series"
			onclick={() => run('add series', () => api.addSeries(mountedPoints))}
			disabled={busy || !mounted}>Add series</button
		>
		<button
			data-testid="replace-series"
			onclick={() =>
				run('replace series', () => api.replaceSeries(mountedPoints, Date.now() % 1000))}
			disabled={busy || !mounted}>Replace series</button
		>
		<button
			data-testid="remove-series"
			onclick={() => run('remove series', () => api.removeSeries())}
			disabled={busy || !mounted}>Remove series</button
		>
		<button
			data-testid="append"
			onclick={() => run('append 1,000 points', () => api.append(mountedPoints, 1000))}
			disabled={busy || !mounted}>Append 1,000 points</button
		>
	</div>
	<ul class="log" data-testid="log">
		{#each log as line, i (i)}
			<li>{line}</li>
		{/each}
	</ul>
</div>

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

<style>
	.panel {
		max-width: 1200px;
		margin-bottom: 1rem;
		font-size: 0.9375rem;
	}

	.panel p {
		margin-bottom: 0.75rem;
		color: #475569;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.controls label {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
	}

	.controls button,
	.controls select {
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0.25rem 0.75rem;
		background: white;
	}

	.controls button:disabled,
	.controls select:disabled {
		opacity: 0.5;
	}

	.separator {
		width: 1px;
		height: 1.5rem;
		background: #cbd5e1;
	}

	.log {
		margin-top: 0.75rem;
		min-height: 2.5rem;
		font-variant-numeric: tabular-nums;
		font-size: 0.8125rem;
		color: #0f172a;
	}
</style>
