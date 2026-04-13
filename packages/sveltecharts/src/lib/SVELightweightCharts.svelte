<script lang="ts">
	import {
		createChart,
		type ChartOptions,
		type DeepPartial,
		type IChartApi
	} from 'lightweight-charts';

	type LightweightChartsConfig = {
		options?: DeepPartial<ChartOptions>;
	};

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

		resizeObserver?.observe(element);
		window.addEventListener('resize', handleResize);

		handleResize();
		onClear = () => undefined;
		onLoad(chart);

		return {
			destroy() {
				window.removeEventListener('resize', handleResize);
				resizeObserver?.disconnect();
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
</div>

<style>
	.lightweight-charts {
		width: 100%;
		height: 100%;
		min-height: 100px;
		position: relative;
		z-index: 1;
	}
</style>
