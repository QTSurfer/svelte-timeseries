<script lang="ts">
	import '../../css/main.css';
	import { base } from '$app/paths';
	import { SvelteTimeSeries } from '$lib';
	import DemoNavbar from '../DemoNavbar.svelte';
	import LegendPanel from '../LegendPanel.svelte';
	import type {
		CandleInterval,
		CandlesSource,
		InjectedMarker,
		InjectedSeries,
		PriceLineInput,
		TimeSeriesChartAdapter
	} from '$lib';
	import type TimeSeriesFacade from '$lib/TimeSeriesFacade';
	import type { Columns } from '$lib/TimeSeriesFacade';
	import { createDemoData, createTicks } from './demoData';

	type Scenario = 'line' | 'candles' | 'ticks' | 'parquet';
	type ChartLibrary = 'echarts' | 'lightweight' | 'vela';
	type LegendMode = 'external' | 'internal';

	// Arrays you already hold: nothing is read from a file and DuckDB is never loaded.
	const demo = createDemoData(900);
	let visibleBars = $state(600);
	// An hour of one-second ticks, aggregated into bars of the chosen length.
	const ticks = createTicks();
	let interval = $state<CandleInterval>('1m');

	let scenario = $state<Scenario>('line');
	let chartLibrary = $state<ChartLibrary>('lightweight');
	// External: a side panel lists the series and markers. Internal: the chart draws its own legend
	// (ECharts only).
	let legendMode = $state<LegendMode>('external');
	const showSidebar = $derived(legendMode === 'external');
	$effect(() => {
		if (chartLibrary !== 'echarts' && legendMode === 'internal') legendMode = 'external';
	});
	let showEma = $state(true);
	let showRsi = $state(true);
	let showMarkers = $state(true);

	// Chart instances created, so an update can be told apart from a rebuild.
	let created = $state(0);

	const slice = <T extends ArrayLike<number | null>>(values: T) =>
		(values as unknown as { slice(start: number, end: number): T }).slice(0, visibleBars);

	const times = $derived(slice(demo.times));
	const close = $derived(slice(demo.close));

	const price = $derived<PriceLineInput | undefined>(
		scenario === 'line' ? { name: 'Price', times, values: close } : undefined
	);
	const candles = $derived<CandlesSource | undefined>(
		scenario === 'candles'
			? { times, open: slice(demo.open), high: slice(demo.high), low: slice(demo.low), close }
			: scenario === 'ticks'
				? { times: ticks.times, values: ticks.values, interval }
				: undefined
	);

	const arraySeries = $derived.by<InjectedSeries[]>(() => {
		const list: InjectedSeries[] = [];
		// The indicators and markers below are computed on the minute bars, not on the ticks.
		if (scenario === 'ticks') return list;
		if (showEma) {
			list.push({ name: 'EMA 20', times, values: slice(demo.ema), color: '#f59e0b', lineWidth: 2 });
		}
		if (showRsi) {
			list.push({ name: 'RSI 14', times, values: slice(demo.rsi), color: '#06b6d4', pane: 1 });
		}
		return list;
	});

	const arrayMarkers = $derived<InjectedMarker[]>(
		showMarkers && scenario !== 'ticks'
			? demo.markers.filter((marker) => marker.time <= times[times.length - 1])
			: []
	);

	// What the side panel hides, by series name and by marker. The chart gets the same lists with
	// those items switched off, so the panel and the chart cannot disagree.
	let hiddenSeries = $state.raw<string[]>([]);
	let hiddenMarkers = $state.raw<string[]>([]);
	const markerKey = (marker: InjectedMarker) => `${marker.kind}-${marker.time}`;
	const toggled = (keys: string[], key: string) =>
		keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
	const visibleSeries = (list: InjectedSeries[]) =>
		list.map((series) =>
			hiddenSeries.includes(series.name) ? { ...series, visible: false } : series
		);
	const visibleMarkers = (list: InjectedMarker[]) =>
		list.filter((marker) => !hiddenMarkers.includes(markerKey(marker)));

	// Parquet scenario: a file drives the chart and the app adds what it computes from that data.
	const TABLE = 'temps_mini';
	// DuckDB reads remote files, so the URL has to be absolute.
	const tables = $derived({
		[TABLE]: {
			url:
				typeof window === 'undefined'
					? ''
					: new URL(`${base}/temps_gzip_mini.parquet`, window.location.origin).href,
			mainColumn: 'temp'
		}
	});
	let parquetSeries = $state.raw<InjectedSeries[]>([]);
	let parquetMarkers = $state.raw<InjectedMarker[]>([]);

	async function onFacadeReady(facade: TimeSeriesFacade) {
		const data = await facade.getDuckDB().getSingleDimension(TABLE, 'temp', false);
		const at = data._ts as number[];
		const values = data.temp as number[];
		parquetSeries = [
			{
				name: 'Moving average (5)',
				times: at,
				values: values.map((_, i) =>
					i < 4 ? null : values.slice(i - 4, i + 1).reduce((sum, value) => sum + value, 0) / 5
				),
				color: '#f59e0b',
				lineWidth: 2
			}
		];

		const events: InjectedMarker[] = [];
		for (let i = 1; i < values.length - 1; i++) {
			if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
				events.push({ time: at[i], kind: 'sell', text: `Local high ${values[i]}` });
			} else if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
				events.push({ time: at[i], kind: 'buy', text: `Local low ${values[i]}` });
			}
		}
		parquetMarkers = events;
	}

	// Vela draws candles only, so it has no series or markers to list.
	const activeSeries = $derived<InjectedSeries[]>(
		chartLibrary === 'vela' ? [] : scenario === 'parquet' ? parquetSeries : arraySeries
	);
	const activeMarkers = $derived<InjectedMarker[]>(
		chartLibrary === 'vela' ? [] : scenario === 'parquet' ? parquetMarkers : arrayMarkers
	);
	// The ticks scenario has nothing to list, so it keeps the whole width for the chart.
	const hasSidebar = $derived(
		showSidebar && (scenario === 'parquet' || activeSeries.length > 0 || activeMarkers.length > 0)
	);
	const markerLabel = (marker: InjectedMarker) =>
		marker.text ?? `${marker.kind} ${new Date(marker.time).toISOString()}`;

	const adapters: Record<string, TimeSeriesChartAdapter> = {};
	function onChartReady(adapter: TimeSeriesChartAdapter) {
		created += 1;
		adapters.current = adapter;
		// Handle for end-to-end checks and for poking at the adapter from the console.
		(window as unknown as { __demo: typeof adapters }).__demo = adapters;
	}
</script>

<div class="grid grid-rows-[auto_auto_1fr] h-screen relative">
	<DemoNavbar current="injected" />

	<div class="border-b bg-base-200 px-4 py-3">
		<div class="flex flex-wrap items-end gap-3">
			<label class="form-control flex w-full max-w-xs flex-col">
				<div class="label pb-1">
					<span class="label-text font-semibold">Source</span>
				</div>
				<select class="select select-bordered" data-testid="scenario" bind:value={scenario}>
					<option value="line">Arrays: price line</option>
					<option value="candles">Arrays: candles</option>
					<option value="ticks">Arrays: ticks to candles</option>
					<option value="parquet">Parquet (temps_gzip_mini) + injected</option>
				</select>
			</label>

			<label class="form-control flex w-full max-w-48 flex-col">
				<div class="label pb-1">
					<span class="label-text font-semibold">Legend</span>
				</div>
				<select class="select select-bordered" data-testid="legend" bind:value={legendMode}>
					<option value="external">External</option>
					<option value="internal" disabled={chartLibrary !== 'echarts'}>Internal</option>
				</select>
			</label>

			<label class="form-control flex w-full max-w-56 flex-col">
				<div class="label pb-1">
					<span class="label-text font-semibold">Chart engine</span>
				</div>
				<select class="select select-bordered" data-testid="engine" bind:value={chartLibrary}>
					<option value="lightweight">Lightweight Charts</option>
					<option value="echarts">ECharts</option>
					<option value="vela">Vela (candles only)</option>
				</select>
			</label>

			{#if scenario === 'ticks'}
				<label class="form-control flex w-full max-w-40 flex-col">
					<div class="label pb-1">
						<span class="label-text font-semibold">Bar length</span>
					</div>
					<select class="select select-bordered" data-testid="interval" bind:value={interval}>
						<option value="1s">1s</option>
						<option value="5s">5s</option>
						<option value="15s">15s</option>
						<option value="1m">1m</option>
						<option value="5m">5m</option>
					</select>
				</label>
			{:else if scenario !== 'parquet'}
				<button
					class="btn btn-outline"
					data-testid="append"
					onclick={() => (visibleBars = Math.min(900, visibleBars + 100))}
				>
					Append 100 bars ({visibleBars})
				</button>
				<button
					class={`btn ${showEma ? 'btn-primary' : 'btn-outline'}`}
					data-testid="toggle-ema"
					onclick={() => (showEma = !showEma)}
				>
					EMA 20
				</button>
				<button
					class={`btn ${showRsi ? 'btn-primary' : 'btn-outline'}`}
					data-testid="toggle-rsi"
					onclick={() => (showRsi = !showRsi)}
				>
					RSI pane
				</button>
				<button
					class={`btn ${showMarkers ? 'btn-primary' : 'btn-outline'}`}
					data-testid="toggle-markers"
					onclick={() => (showMarkers = !showMarkers)}
				>
					Markers
				</button>
			{/if}
		</div>

		<div class="mt-3 text-sm text-base-content/70" data-testid="created">
			charts created: {created}
		</div>
	</div>

	<div class="size-full overflow-hidden">
		{#key `${scenario}-${chartLibrary}-${legendMode}`}
			{#if scenario === 'parquet'}
				<SvelteTimeSeries
					table={tables}
					injectedSeries={visibleSeries(parquetSeries)}
					injectedMarkers={visibleMarkers(parquetMarkers)}
					debug={false}
					externalManagerLegend={showSidebar}
					{chartLibrary}
					{onFacadeReady}
					{onChartReady}
					columnsSnippet={legendSidebar}
					containerClass={hasSidebar
						? 'relative grid grid-cols-[300px_1fr] size-full'
						: 'relative size-full'}
					snippetClass={hasSidebar ? 'flex flex-col p-2 gap-2 overflow-hidden' : 'hidden'}
					chartClass="w-full h-full"
				/>
			{:else}
				<SvelteTimeSeries
					{price}
					{candles}
					injectedSeries={visibleSeries(arraySeries)}
					injectedMarkers={visibleMarkers(arrayMarkers)}
					{chartLibrary}
					externalManagerLegend={showSidebar}
					{onChartReady}
					debug={false}
					columnsSnippet={legendSidebar}
					containerClass={hasSidebar
						? 'relative grid grid-cols-[300px_1fr] size-full'
						: 'relative size-full'}
					snippetClass={hasSidebar ? 'flex flex-col p-2 gap-2 overflow-hidden' : 'hidden'}
					chartClass="w-full h-full"
				/>
			{/if}
		{/key}
	</div>
</div>

{#snippet legendSidebar(props: { columns: Columns; toggleColumn: (name: string) => unknown })}
	{#if showSidebar}
		{#if props.columns.length > 0}
			<LegendPanel
				title="SCHEMA"
				fixedHeight
				items={props.columns.map((column) => ({
					label: column.name,
					checked: column.checked,
					onToggle: () => props.toggleColumn(column.name)
				}))}
			/>
		{/if}
		{#if activeSeries.length > 0}
			<LegendPanel
				title="SERIES"
				items={activeSeries.map((series) => ({
					label: series.name,
					checked: !hiddenSeries.includes(series.name),
					onToggle: () => (hiddenSeries = toggled(hiddenSeries, series.name))
				}))}
			/>
		{/if}
		{#if activeMarkers.length > 0}
			<LegendPanel
				title="MARKERS"
				boldLabels
				items={activeMarkers.map((marker) => ({
					label: markerLabel(marker),
					checked: !hiddenMarkers.includes(markerKey(marker)),
					onToggle: () => (hiddenMarkers = toggled(hiddenMarkers, markerKey(marker))),
					onGo: () => adapters.current?.scrollToTime(marker.time)
				}))}
			/>
		{/if}
	{/if}
{/snippet}
