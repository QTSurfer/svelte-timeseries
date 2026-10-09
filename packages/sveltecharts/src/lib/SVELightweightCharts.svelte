<script lang="ts">
	import {
		createChart,
		type ChartOptions,
		type DeepPartial,
		type IChartApi,
		type ISeriesApi,
		type SeriesType,
		type MouseEventParams,
		type Time
	} from 'lightweight-charts';
	import { formatPreciseValue } from './LightweightTimeSeriesChartBuilder';
	import { getChartHoverHooks } from './chartHooks';
	import type { MarkerHoverItem } from './injectedMarkers';

	type LightweightChartsConfig = {
		options?: DeepPartial<ChartOptions>;
	};

	type TooltipRow = { label: string; value: string };

	let {
		onLoad,
		config,
		loading = $bindable(false),
		onClear = $bindable(),
		isDark = false
	}: {
		onLoad: (instance: IChartApi) => Promise<void>;
		config?: LightweightChartsConfig;
		loading?: boolean;
		onClear?: () => void;
		isDark?: boolean;
	} = $props();

	let chart: IChartApi | undefined;

	// Tooltip state
	let tooltipVisible = $state(false);
	let tooltipX = $state(0);
	let tooltipY = $state(0);
	let tooltipTime = $state('');
	let tooltipRows = $state<TooltipRow[]>([]);
	let tooltipMarkers = $state<MarkerHoverItem[]>([]);
	let tooltipMoreMarkers = $state(0);

	const baseOptions = $derived<DeepPartial<ChartOptions>>({
		layout: {
			background: {
				color: isDark ? '#100c2a' : '#ffffff'
			},
			textColor: isDark ? '#f8fafc' : '#0f172a'
		},
		grid: {
			vertLines: {
				color: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.2)'
			},
			horzLines: {
				color: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.2)'
			}
		},
		rightPriceScale: {
			borderColor: isDark ? '#334155' : '#cbd5e1'
		},
		leftPriceScale: {
			borderColor: isDark ? '#334155' : '#cbd5e1'
		},
		timeScale: {
			borderColor: isDark ? '#334155' : '#cbd5e1',
			timeVisible: true
		},
		crosshair: {
			vertLine: {
				color: isDark ? '#64748b' : '#94a3b8'
			},
			horzLine: {
				color: isDark ? '#64748b' : '#94a3b8'
			}
		}
	});

	const chartOptions = $derived({
		...baseOptions,
		...(config?.options ?? {})
	});

	function formatTime(time: Time): string {
		const ts = (time as number) * 1000;
		const d = new Date(ts);
		return d.toISOString().replace('T', ' ').slice(0, 19);
	}

	function handleCrosshairMove(param: MouseEventParams<Time>, container: HTMLElement) {
		if (!param.point || !param.time) {
			tooltipVisible = false;
			return;
		}

		// Hooks come from the builder created for this chart (if any): own value formatting for
		// injected series and the markers drawn on the bar under the cursor.
		const hooks = chart ? getChartHoverHooks(chart) : undefined;

		const rows: TooltipRow[] = [];
		for (const [series, data] of param.seriesData as Map<
			ISeriesApi<SeriesType, Time>,
			{ value?: number }
		>) {
			if (!series.options().visible) continue;
			const value = data?.value;
			if (value === undefined || value === null) continue;
			const label = (series.options() as { title?: string }).title ?? '';
			rows.push({
				label,
				value: hooks?.formatValue(series, value) ?? formatPreciseValue(value)
			});
		}

		const markerHover = hooks?.getMarkerHover(param) ?? null;

		if (rows.length === 0 && !markerHover) {
			tooltipVisible = false;
			return;
		}

		tooltipRows = rows;
		tooltipMarkers = markerHover?.items ?? [];
		tooltipMoreMarkers = markerHover?.more ?? 0;
		tooltipTime = formatTime(param.time);

		// Position tooltip near cursor, avoiding overflow
		const containerRect = container.getBoundingClientRect();
		const TOOLTIP_WIDTH = markerHover ? 260 : 160;
		const TOOLTIP_OFFSET = 12;

		let x = param.point.x + TOOLTIP_OFFSET;
		if (x + TOOLTIP_WIDTH > containerRect.width) {
			x = param.point.x - TOOLTIP_WIDTH - TOOLTIP_OFFSET;
		}

		tooltipX = x;
		tooltipY = Math.max(0, param.point.y - 20);
		tooltipVisible = true;
	}

	function chartAction(element: HTMLElement) {
		chart = createChart(element, chartOptions);

		const handleResize = () => {
			chart?.applyOptions({
				width: element.clientWidth,
				height: element.clientHeight
			});
		};

		const resizeObserver =
			typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(handleResize);

		if (resizeObserver) {
			resizeObserver.observe(element);
		} else {
			window.addEventListener('resize', handleResize);
		}

		const onCrosshairMove = (param: MouseEventParams<Time>) => handleCrosshairMove(param, element);
		chart.subscribeCrosshairMove(onCrosshairMove);

		handleResize();
		onClear = () => undefined;
		onLoad(chart);

		return {
			destroy() {
				chart?.unsubscribeCrosshairMove(onCrosshairMove);
				if (resizeObserver) {
					resizeObserver.disconnect();
				} else {
					window.removeEventListener('resize', handleResize);
				}
				chart?.remove();
			}
		};
	}

	$effect(() => {
		chart?.applyOptions(chartOptions);
	});
</script>

<div style="position: relative; width: 100%; height: 100%;">
	<div class="lightweight-charts" use:chartAction></div>

	{#if tooltipVisible}
		<div
			class="lw-tooltip"
			class:lw-tooltip--dark={isDark}
			style="left: {tooltipX}px; top: {tooltipY}px;"
		>
			<div class="lw-tooltip__time">{tooltipTime}</div>
			{#each tooltipRows as row, i (i)}
				<div class="lw-tooltip__row">
					{#if row.label}<span class="lw-tooltip__label">{row.label}</span>{/if}
					<span class="lw-tooltip__value">{row.value}</span>
				</div>
			{/each}
			{#if tooltipMarkers.length > 0}
				<div class="lw-tooltip__markers">
					{#each tooltipMarkers as marker, i (i)}
						<div class="lw-tooltip__marker">
							<span class="lw-tooltip__swatch" style="background: {marker.color};"></span>
							<span class="lw-tooltip__marker-text">
								<b>{marker.kindLabel}</b>
								{#if marker.price !== undefined}@ {formatPreciseValue(marker.price)}{/if}
								{#if marker.text}<span class="lw-tooltip__note">{marker.text}</span>{/if}
							</span>
						</div>
					{/each}
					{#if tooltipMoreMarkers > 0}
						<div class="lw-tooltip__more">+{tooltipMoreMarkers} more</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lightweight-charts {
		width: 100%;
		height: 100%;
		min-height: 100px;
		position: relative;
		z-index: 1;
	}

	.lw-tooltip {
		position: absolute;
		z-index: 10;
		pointer-events: none;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 12px;
		color: #0f172a;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		min-width: 120px;
		max-width: 260px;
	}

	.lw-tooltip--dark {
		background: rgba(20, 16, 50, 0.95);
		border-color: #334155;
		color: #f8fafc;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	.lw-tooltip__time {
		font-size: 11px;
		opacity: 0.6;
		margin-bottom: 4px;
		white-space: nowrap;
	}

	.lw-tooltip__row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		line-height: 1.6;
	}

	.lw-tooltip__label {
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lw-tooltip__value {
		font-weight: 600;
		white-space: nowrap;
	}

	.lw-tooltip__markers {
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid rgba(148, 163, 184, 0.4);
	}

	.lw-tooltip__marker {
		display: flex;
		align-items: baseline;
		gap: 6px;
		line-height: 1.5;
	}

	.lw-tooltip__swatch {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.lw-tooltip__marker-text {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.lw-tooltip__note {
		display: block;
		opacity: 0.85;
	}

	.lw-tooltip__more {
		opacity: 0.6;
		font-size: 11px;
	}
</style>
