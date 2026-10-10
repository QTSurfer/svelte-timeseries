<script lang="ts">
	/**
	 * Price data you already hold, as arrays, drawn on either chart backend: no DuckDB, no parquet.
	 * Combine it with injected series (indicators) and injected markers (trades, events).
	 *
	 * Time values are epoch milliseconds. Pass new arrays to update; the chart is not rebuilt.
	 *
	 * `chartLibrary="vela"` draws `candles` only (Vela renders one OHLCV market) and does not draw
	 * injected series, markers or panes: a `price` line is rejected with a message and the injected
	 * input is ignored with a one-time warning. Vela is loaded on demand, so the other engines never
	 * download it.
	 */
	import SVECharts from './SVECharts.svelte';
	import SVELightweightCharts from './SVELightweightCharts.svelte';
	import { TimeSeriesChartBuilder } from './TimeSeriesChartBuilder';
	import { LightweightTimeSeriesChartBuilder } from './LightweightTimeSeriesChartBuilder';
	import type { TimeSeriesChartAdapter } from './chartAdapter';
	import { describeUnsupportedInput } from './inputSupport';
	import type { ECharts, LightweightChartApi, VelaChartApi } from './types';
	import type { InjectedMarker } from './injectedMarkers';
	import type { InjectedSeries } from './seriesInput';
	import {
		applyPriceData,
		priceSignature,
		resolvePriceData,
		type CandlesSource,
		type PriceLineInput,
		type ResolvedPriceData
	} from './priceInput';

	let {
		chartLibrary = 'echarts',
		price,
		candles,
		injectedSeries,
		injectedMarkers,
		paneHeights,
		externalManagerLegend = false,
		isDark = false,
		onChartReady
	}: {
		/** Chart backend. Default `'echarts'`. `'vela'` draws candles only. */
		chartLibrary?: 'echarts' | 'lightweight' | 'vela';
		/** A price line from arrays. Ignored when `candles` is given. */
		price?: PriceLineInput;
		/** Candles from OHLC arrays, or a price line with an `interval` to aggregate into bars. */
		candles?: CandlesSource;
		/** Named line series computed by your app (indicators). Replace the array to update. */
		injectedSeries?: readonly InjectedSeries[];
		/** Buy / sell / info events. Replace the array to update. */
		injectedMarkers?: readonly InjectedMarker[];
		/** Relative pane heights keyed by pane number, e.g. `{ 0: 3, 1: 1 }`. */
		paneHeights?: Readonly<Record<number, number>>;
		/** ECharts only: hide the built-in legend (default `false`, the legend toggles series). */
		externalManagerLegend?: boolean;
		isDark?: boolean;
		/** Called once the chart exists and its price data is drawn, with the adapter for anything else. */
		onChartReady?: (adapter: TimeSeriesChartAdapter) => void;
	} = $props();

	// The chart is rebuilt only when the kind of price data changes (line <-> candles, or another
	// series name). Changing values, injected series or markers never rebuilds it.
	const chartKey = $derived(`${chartLibrary}:${priceSignature(price, candles)}`);

	let ready = $state.raw<{ adapter: TimeSeriesChartAdapter; key: string }>();
	/** Why the price input cannot be drawn by this engine, shown instead of an empty chart. */
	let rejection = $state('');
	let applied: ResolvedPriceData | undefined;
	let announced = false;
	const reported: Record<string, true> = {};

	function report(issues: string[]) {
		for (const issue of issues) {
			if (reported[issue]) continue;
			reported[issue] = true;
			console.warn(`[sveltecharts] ${issue}`);
		}
	}

	let destroyed = false;
	$effect(() => () => {
		destroyed = true;
	});

	/**
	 * Zooms a new chart out to all of its data. ECharts opens on a narrow window meant for the DuckDB
	 * viewport flow, and Lightweight Charts fits against a size that is not final yet in the frame
	 * the chart was created in, so this waits for the next frame.
	 */
	function showAll(target: { adapter: TimeSeriesChartAdapter; key: string }) {
		requestAnimationFrame(() => {
			if (!destroyed && ready === target) target.adapter.goToZoom(0, 100);
		});
	}

	function attach(adapter: TimeSeriesChartAdapter, key = chartKey) {
		applied = undefined;
		announced = false;
		ready = { adapter, key };
	}

	async function onLoadECharts(instance: ECharts) {
		attach(new TimeSeriesChartBuilder(instance, { externalManagerLegend }));
	}

	async function onLoadLightweight(instance: LightweightChartApi) {
		attach(new LightweightTimeSeriesChartBuilder(instance, { externalManagerLegend }));
	}

	async function onLoadVela(instance: VelaChartApi) {
		// Loaded on demand: the other engines never download Vela.
		const key = chartKey;
		const { VelaTimeSeriesChartBuilder } = await import('./VelaTimeSeriesChartBuilder');
		// The chart may have been replaced or destroyed while the module loaded.
		if (destroyed || key !== chartKey) return;
		attach(new VelaTimeSeriesChartBuilder(instance), key);
	}

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		const { data, issues } = resolvePriceData(price, candles);
		report(issues);
		if (chartLibrary === 'vela' && data.mode === 'line') {
			rejection =
				'chartLibrary="vela" draws candles only: pass "candles", or use "echarts" or "lightweight" for a price line.';
			report([rejection]);
			return;
		}
		rejection = '';
		const outcome = applyPriceData(target.adapter, data, applied);
		// Vela fits itself to its data; moving it before its data has landed leaves the chart blank.
		if (outcome === 'created' && chartLibrary !== 'vela') showAll(target);
		applied = data;
		if (!announced) {
			announced = true;
			onChartReady?.(target.adapter);
		}
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		report(describeUnsupportedInput(target.adapter, chartLibrary, { injectedSeries }));
		target.adapter.setInjectedSeries?.(injectedSeries ?? []);
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		report(describeUnsupportedInput(target.adapter, chartLibrary, { injectedMarkers }));
		target.adapter.setInjectedMarkers?.(injectedMarkers ?? []);
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey || !paneHeights) return;
		report(describeUnsupportedInput(target.adapter, chartLibrary, { paneHeights }));
		target.adapter.setPaneHeights?.(paneHeights);
	});
</script>

{#key chartKey}
	{#if chartLibrary === 'lightweight'}
		<SVELightweightCharts onLoad={onLoadLightweight} {isDark} />
	{:else if chartLibrary === 'vela'}
		{#await import('./SVEVelaCharts.svelte') then { default: SVEVelaCharts }}
			<SVEVelaCharts onLoad={onLoadVela} {isDark} />
		{/await}
	{:else}
		<SVECharts onLoad={onLoadECharts} {isDark} />
	{/if}
{/key}
{#if rejection}
	<div class="sts-chart-rejection" role="alert">{rejection}</div>
{/if}

<style>
	.sts-chart-rejection {
		position: absolute;
		left: 1rem;
		right: 1rem;
		top: 1rem;
		z-index: 3;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background-color: rgba(220, 38, 38, 0.1);
		border: 1px solid rgba(220, 38, 38, 0.4);
		color: #dc2626;
		font-size: 0.875rem;
	}
</style>
