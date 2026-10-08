<script lang="ts">
	/**
	 * Price data you already hold, as arrays, drawn on either chart backend: no DuckDB, no parquet.
	 * Combine it with injected series (indicators) and injected markers (trades, events).
	 *
	 * Time values are epoch milliseconds. Pass new arrays to update; the chart is not rebuilt.
	 */
	import SVECharts from './SVECharts.svelte';
	import SVELightweightCharts from './SVELightweightCharts.svelte';
	import { TimeSeriesChartBuilder } from './TimeSeriesChartBuilder';
	import { LightweightTimeSeriesChartBuilder } from './LightweightTimeSeriesChartBuilder';
	import type { TimeSeriesChartAdapter } from './chartAdapter';
	import type { ECharts, LightweightChartApi } from './types';
	import type { InjectedMarker } from './injectedMarkers';
	import type { InjectedSeries } from './seriesInput';
	import {
		applyPriceData,
		priceSignature,
		resolvePriceData,
		type CandlesInput,
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
		/** Chart backend. Default `'echarts'`. */
		chartLibrary?: 'echarts' | 'lightweight';
		/** A price line from arrays. Ignored when `candles` is given. */
		price?: PriceLineInput;
		/** Candles from OHLC arrays. */
		candles?: CandlesInput;
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

	function attach(adapter: TimeSeriesChartAdapter) {
		applied = undefined;
		announced = false;
		ready = { adapter, key: chartKey };
	}

	async function onLoadECharts(instance: ECharts) {
		attach(new TimeSeriesChartBuilder(instance, { externalManagerLegend }));
	}

	async function onLoadLightweight(instance: LightweightChartApi) {
		attach(new LightweightTimeSeriesChartBuilder(instance, { externalManagerLegend }));
	}

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		const { data, issues } = resolvePriceData(price, candles);
		report(issues);
		const outcome = applyPriceData(target.adapter, data, applied);
		if (outcome === 'created') showAll(target);
		applied = data;
		if (!announced) {
			announced = true;
			onChartReady?.(target.adapter);
		}
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		target.adapter.setInjectedSeries?.(injectedSeries ?? []);
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey) return;
		target.adapter.setInjectedMarkers?.(injectedMarkers ?? []);
	});

	$effect(() => {
		const target = ready;
		if (!target || target.key !== chartKey || !paneHeights) return;
		target.adapter.setPaneHeights?.(paneHeights);
	});
</script>

{#key chartKey}
	{#if chartLibrary === 'lightweight'}
		<SVELightweightCharts onLoad={onLoadLightweight} {isDark} />
	{:else}
		<SVECharts onLoad={onLoadECharts} {isDark} />
	{/if}
{/key}
