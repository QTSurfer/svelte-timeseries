<script lang="ts">
	import '../css/main.css';
	import { SvelteTimeSeries } from '$lib';
	import {
		DuckDB,
		type MarkersTableOptions,
		type OHLCResolution,
		type Tables
	} from '$lib/duckdb/DuckDB';
	import { onMount } from 'svelte';
	import EyeIcon from '$lib/icon/EyeIcon.svelte';
	import EyeOffIcon from '$lib/icon/EyeOffIcon.svelte';
	import Icon from '@iconify/svelte';

	type DemoConfiguration = {
		name: string;
		markers?: MarkersTableOptions;
		tables: Tables;
	};

	type SourceMode = 'url' | 'file';
	type LegendMode = 'external' | 'internal';
	type ChartLibrary = 'echarts' | 'lightweight';

	const CUSTOM_CONFIGURATION_ID = 'custom';

	let selected = $state('preset:2');
	let baseUrl = $state<string>(typeof window !== 'undefined' ? window.location.href : '');
	let sourceMode = $state<SourceMode>('file');
	let legendMode = $state<LegendMode>('external');
	let chartLibrary = $state<ChartLibrary>('echarts');
	let customUrl = $state('');
	let customFile = $state<File | null>(null);
	let customColumns = $state<string[]>([]);
	let customMainColumn = $state('');
	let customResolution = $state<OHLCResolution | '' | 'line'>('');
	let customError = $state('');
	let inspectingCustomFile = $state(false);
	let loadedCustomConfiguration = $state<DemoConfiguration | null>(null);
	let customRenderNonce = $state(0);

	let configurations = $derived<DemoConfiguration[]>([
		{
			name: 'Minimal data',
			tables: {
				temps_mini: {
					url: `${baseUrl}temps_gzip_mini.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: '1 million rows data',
			tables: {
				temps: {
					url: `${baseUrl}temps_gzip.parquet`,
					mainColumn: 'temp'
				}
			}
		},
		{
			name: 'Partial data: Handling up to 1.807.956 values',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}signals.parquet`,
					mainColumn: 'price',
					columnsSelect: ['_ts', 'price', 'VlongBolBW%', 'ema500'] // Limited colums table
				}
			}
		},
		{
			name: 'BTC/USDT — 1s Candlestick',
			tables: {
				btc: {
					url: `${baseUrl}BTC_USDT_2026-04-19_h01_klines.parquet`,
					mainColumn: 'cls'
				}
			}
		},
		{
			name: 'All data: Handling up to 10.245.084 values',
			markers: {
				table: 'signal',
				targetColumn: '_m',
				targetDimension: 'price'
			},
			tables: {
				signal: {
					url: `${baseUrl}signals.parquet`,
					mainColumn: 'price'
				}
			}
		}
	]);

	const activeConfiguration = $derived<DemoConfiguration | null>(
		selected === CUSTOM_CONFIGURATION_ID
			? loadedCustomConfiguration
			: (configurations[Number(selected.replace('preset:', ''))] ?? null)
	);

	const renderKey = $derived(
		selected === CUSTOM_CONFIGURATION_ID
			? `${CUSTOM_CONFIGURATION_ID}-${customRenderNonce}-${legendMode}-${chartLibrary}`
			: `${selected}-${legendMode}-${chartLibrary}`
	);
	const showCustomSidebar = $derived(legendMode === 'external');

	$effect(() => {
		if (chartLibrary === 'lightweight' && legendMode === 'internal') {
			legendMode = 'external';
		}
	});

	function setSourceMode(mode: SourceMode) {
		sourceMode = mode;
		customError = '';
		loadedCustomConfiguration = null;

		if (mode === 'url') {
			customFile = null;
			customColumns = [];
			customMainColumn = customMainColumn || 'temp';
		} else {
			customUrl = '';
			customColumns = [];
			customMainColumn = '';
		}
	}

	async function inspectCustomFile(file: File) {
		inspectingCustomFile = true;
		customError = '';
		customColumns = [];
		customMainColumn = '';
		loadedCustomConfiguration = null;

		let duckDb:
			| Awaited<
					ReturnType<
						typeof DuckDB.create<{
							uploaded_preview: {
								parquet: File;
								mainColumn: string;
							};
						}>
					>
			  >
			| undefined;

		try {
			duckDb = await DuckDB.create(
				{
					uploaded_preview: {
						parquet: file,
						mainColumn: '__preview__'
					}
				},
				undefined,
				false
			);

			customColumns = duckDb.getColumns('uploaded_preview');
			customMainColumn = customColumns[0] ?? '';

			if (!customColumns.length) {
				customError = 'No plottable columns were found in the parquet file.';
			}
		} catch (error) {
			customError =
				error instanceof Error ? error.message : 'The parquet file could not be inspected.';
		} finally {
			await duckDb?.closeConnection();
			inspectingCustomFile = false;
		}
	}

	async function onCustomFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement | null;
		const file = input?.files?.[0] ?? null;
		customFile = file;
		customError = '';
		loadedCustomConfiguration = null;

		if (file) {
			await inspectCustomFile(file);
		}
	}

	function clearCustomFile() {
		customFile = null;
		customColumns = [];
		customMainColumn = '';
		customError = '';
		loadedCustomConfiguration = null;
	}

	function loadCustomSource() {
		customError = '';

		if (sourceMode === 'url') {
			const url = customUrl.trim();
			const mainColumn = customMainColumn.trim();

			if (!url || !mainColumn) {
				customError = 'Complete the URL and the main column before loading.';
				return;
			}

			const candlestickOverride =
				customResolution === 'line'
					? { candlestick: false as const }
					: customResolution
						? { resolution: customResolution }
						: {};

			loadedCustomConfiguration = {
				name: `Remote parquet: ${url}`,
				tables: {
					remote: { url, mainColumn, ...candlestickOverride }
				}
			};
		} else {
			if (!customFile) {
				customError = 'Select a parquet file first.';
				return;
			}

			if (!customMainColumn) {
				customError = 'Select the main column before loading.';
				return;
			}

			const candlestickOverride =
				customResolution === 'line'
					? { candlestick: false as const }
					: customResolution
						? { resolution: customResolution }
						: {};

			loadedCustomConfiguration = {
				name: `Local parquet: ${customFile.name}`,
				tables: {
					uploaded: { parquet: customFile, mainColumn: customMainColumn, ...candlestickOverride }
				}
			};
		}

		customRenderNonce += 1;
		selected = CUSTOM_CONFIGURATION_ID;
	}

	onMount(() => {
		baseUrl = window.location.href;
	});
</script>

<div class="grid grid-rows-[auto_auto_1fr] h-screen relative">
	<div class="navbar shadow-sm bg-primary">
		<div class="navbar-start text-primary-content">
			<div class="flex gap-2 items-baseline text-2xl font-bold">
				SvelteTimeSeries <span class="font-extralight text-sm">DEMO</span>
			</div>
		</div>

		<div class="navbar-center"></div>
		<div class="navbar-end">
			<div class="flex gap-8 text-primary-content px-4">
				<a href="https://github.com/QTSurfer/svelte-timeseries" target="_blank">
					<Icon icon="fa6-brands:github" width="1.5em" height="1.5em" />
				</a>
				<a href="https://x.com/QTSurfer" target="_blank" class="tooltip tooltip-bottom z-10">
					<Icon icon="fa6-brands:x-twitter" width="1.5em" height="1.5em" />
				</a>
				<a
					href="https://npmjs.com/package/@qtsurfer/svelte-timeseries"
					target="_blank"
					class="tooltip tooltip-bottom z-10 flex gap-2 items-center"
				>
					<img
						src="https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?label=version&style=flat-square"
						alt="version"
					/>
					<img
						src="https://img.shields.io/npm/dt/%40qtsurfer%2Fsvelte-timeseries?label=downloads&style=flat-square"
						alt="downloads"
					/>
				</a>
			</div>
		</div>
	</div>

	<div class="border-b bg-base-200 px-4 py-3">
		<div class="flex flex-wrap items-end gap-3">
			<label class="form-control w-full max-w-sm">
				<div class="label pb-1">
					<span class="label-text font-semibold">Scenario</span>
				</div>
				<select class="select select-bordered" bind:value={selected}>
					{#each configurations as config, i (i)}
						<option value={`preset:${i}`}>
							{config.name}
						</option>
					{/each}
					<option value={CUSTOM_CONFIGURATION_ID}>Custom source</option>
				</select>
			</label>

			<label class="form-control w-full max-w-48">
				<div class="label pb-1">
					<span class="label-text font-semibold">Legend</span>
				</div>
				<select class="select select-bordered" bind:value={legendMode}>
					<option value="external">External</option>
					<option value="internal" disabled={chartLibrary === 'lightweight'}>Internal</option>
				</select>
			</label>

			<label class="form-control w-full max-w-56">
				<div class="label pb-1">
					<span class="label-text font-semibold">Chart engine</span>
				</div>
				<select class="select select-bordered" bind:value={chartLibrary}>
					<option value="echarts">ECharts</option>
					<option value="lightweight">Lightweight Charts</option>
				</select>
			</label>

			{#if selected === CUSTOM_CONFIGURATION_ID}
				<label class="form-control w-full max-w-40">
					<div class="label pb-1">
						<span class="label-text font-semibold">Resolution</span>
					</div>
					<select class="select select-bordered" bind:value={customResolution}>
						<option value="">Auto (candlestick if detected)</option>
						<option value="line">Line (disable candlestick)</option>
						<option value="15s">Candlestick — 15 seconds</option>
						<option value="1m">Candlestick — 1 minute</option>
						<option value="5m">Candlestick — 5 minutes</option>
						<option value="15m">Candlestick — 15 minutes</option>
						<option value="1h">Candlestick — 1 hour</option>
						<option value="4h">Candlestick — 4 hours</option>
						<option value="1d">Candlestick — 1 day</option>
					</select>
				</label>

				<div class="join">
					<button
						class={`btn join-item ${sourceMode === 'url' ? 'btn-primary' : 'btn-outline'}`}
						onclick={() => setSourceMode('url')}
					>
						URL
					</button>
					<button
						class={`btn join-item ${sourceMode === 'file' ? 'btn-primary' : 'btn-outline'}`}
						onclick={() => setSourceMode('file')}
					>
						File
					</button>
				</div>

				{#if sourceMode === 'url'}
					<label class="form-control w-full max-w-md">
						<div class="label pb-1">
							<span class="label-text font-semibold">Parquet URL</span>
						</div>
						<input
							class="input input-bordered"
							type="url"
							bind:value={customUrl}
							placeholder="https://example.com/data.parquet"
						/>
					</label>

					<label class="form-control w-full max-w-xs">
						<div class="label pb-1">
							<span class="label-text font-semibold">Main column</span>
						</div>
						<input
							class="input input-bordered"
							type="text"
							bind:value={customMainColumn}
							placeholder="price"
						/>
					</label>
				{:else}
					<label class="form-control w-full max-w-sm">
						<div class="label pb-1">
							<span class="label-text font-semibold">Parquet file</span>
						</div>
						<input
							class="file-input file-input-bordered"
							type="file"
							accept=".parquet,.pqt,application/octet-stream"
							onchange={onCustomFileChange}
						/>
					</label>

					{#if customFile}
						<label class="form-control w-full max-w-xs">
							<div class="label pb-1">
								<span class="label-text font-semibold">Main column</span>
							</div>
							<select
								class="select select-bordered"
								bind:value={customMainColumn}
								disabled={inspectingCustomFile || customColumns.length === 0}
							>
								<option value="" disabled selected={!customMainColumn}> Select column </option>
								{#each customColumns as column (column)}
									<option value={column}>{column}</option>
								{/each}
							</select>
						</label>

						<button class="btn btn-ghost" onclick={clearCustomFile}>Clear</button>
					{/if}
				{/if}

				<button
					class="btn btn-primary"
					onclick={loadCustomSource}
					disabled={sourceMode === 'url'
						? !customUrl.trim() || !customMainColumn.trim()
						: !customFile || !customMainColumn || inspectingCustomFile}
				>
					{inspectingCustomFile ? 'Reading parquet...' : 'Load'}
				</button>
			{/if}
		</div>

		{#if selected === CUSTOM_CONFIGURATION_ID}
			<div class="mt-3 text-sm text-base-content/70">
				The parquet file can provide the time column as <code>_ts</code>, <code>ts</code>,
				<code>_t</code>, or <code>t</code>. In file mode: 1. select the parquet file, 2. choose the
				<code>mainColumn</code>, 3. press <code>Load</code>.
			</div>
		{/if}

		{#if chartLibrary === 'lightweight'}
			<div class="mt-3 text-sm text-base-content/70">
				Lightweight Charts uses the external schema controls in this demo.
			</div>
		{/if}

		{#if selected === CUSTOM_CONFIGURATION_ID && customError}
			<div class="mt-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
				{customError}
			</div>
		{/if}
	</div>

	<div class="size-full overflow-hidden">
		{#if activeConfiguration}
			{#key renderKey}
				{@const configuration = activeConfiguration}
				<SvelteTimeSeries
					table={configuration.tables}
					markers={configuration.markers}
					debug={false}
					externalManagerLegend={legendMode === 'external'}
					{chartLibrary}
					containerClass={showCustomSidebar
						? 'relative grid grid-cols-[300px_1fr] size-full'
						: 'relative size-full'}
					snippetclass={showCustomSidebar ? 'flex flex-col p-2 gap-2 overflow-hidden' : 'hidden'}
					chartClass="w-full h-full"
				>
					{#snippet columnsSnippet(props)}
						{#if showCustomSidebar && props.columns.length > 0}
							<details
								class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
								name="data"
								open
							>
								<summary class="collapse-title font-semibold"> SCHEMA </summary>
								<div class="collapse-content text-sm p-0 h-100">
									<ul class="list overflow-auto h-full bg-base-100">
										{#each props.columns as column (column.name)}
											<li class="list-row">
												<div class="list-col-grow">
													{column.name}
												</div>
												<div>
													<label>
														<input
															type="checkbox"
															hidden
															checked={column.checked}
															onchange={() => props.toggleColumn(column.name)}
														/>
														{#if column.checked}
															<div class="swap-on">
																<EyeIcon />
															</div>
														{:else}
															<div class="swap-off">
																<EyeOffIcon />
															</div>
														{/if}
													</label>
												</div>
											</li>
										{/each}
									</ul>
								</div>
							</details>
						{/if}
					{/snippet}

					{#snippet markersSnippet(props)}
						{#if showCustomSidebar}
							<details
								class="collapse collapse-arrow bg-base-300 border border-base-300 min-h-[3.6rem] max-h-full"
								name="data"
								open
							>
								<summary class="collapse-title font-semibold"> MARKERS </summary>
								<div class="collapse-content text-sm p-0">
									<ul class="list overflow-auto h-full bg-base-100">
										{#each props.markers as marker, i (i)}
											<li class="list-row">
												<div class="flex items-center">
													<button
														class="btn btn-primary btn-xs"
														onclick={() => props.goToMarker(marker._ts)}
													>
														Go to
													</button>
												</div>
												<div class="list-col-grow">
													<div class="font-bold">{marker.text}</div>
												</div>
												<div class="flex items-center">
													<label class="swap">
														<input
															type="checkbox"
															checked={true}
															onchange={() => props.toggleMarker(i, marker.shape)}
														/>

														<div class="swap-on">
															<EyeIcon />
														</div>
														<div class="swap-off">
															<EyeOffIcon />
														</div>
													</label>
												</div>
											</li>
										{/each}
									</ul>
								</div>
							</details>
						{/if}
					{/snippet}

					{#snippet performanceSnippet(props)}
						<div class="absolute bottom-4 w-full z-10 text-sm pointer-events-none left-0 right-0">
							<div class="mx-auto w-lg text-center py-4 bg-base-300 z-10 p-2 rounded-2xl shadow-md">
								Initial Loading {props.time.toFixed(2)} s | Load Dimensions [{props.matrix[0]} x {props.matrix[1].toLocaleString(
									'es-AR'
								)}]
								<b>{(props.matrix[0] * props.matrix[1]).toLocaleString('es-AR')} values</b>
							</div>
						</div>
					{/snippet}
				</SvelteTimeSeries>
			{/key}
		{:else}
			<div class="flex items-center justify-center size-full">
				<div class="text-center">
					<div class="text-4xl font-light text-stone-400">Configure a source</div>
					<div class="mt-2 text-stone-500">
						Select `Custom source`, complete the inputs, and press `Load`.
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
