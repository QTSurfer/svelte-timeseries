<script lang="ts" module>
	import { init, use } from 'echarts/core';
	import { LineChart, BarChart } from 'echarts/charts';
	import {
		DataZoomComponent,
		LegendComponent,
		TitleComponent,
		TooltipComponent,
		GridComponent,
		DatasetComponent
	} from 'echarts/components';
	import { LabelLayout } from 'echarts/features';
	import { CanvasRenderer } from 'echarts/renderers';
	import type { ECharts, EChartsOption } from './types';
	// Register the required components
	use([
		LineChart,
		BarChart,
		DataZoomComponent,
		LegendComponent,
		TitleComponent,
		TooltipComponent,
		GridComponent,
		DatasetComponent,
		LabelLayout,
		CanvasRenderer
	]);

	export type EChartsTheme = string | object;
	export type EChartsRenderer = 'canvas' | 'svg';

	export type EChartsConfig = {
		theme?: EChartsTheme;
		renderer?: EChartsRenderer;
		option: EChartsOption;
	};

	export type DataRange = { start: number; end: number };
	export type DataZoomEventSingle = { batch?: never } & DataRange;
	export type DataZoomEventBatch = { batch: DataRange[]; start?: never; end?: never };

	export type DataZoomEvent = DataZoomEventBatch | DataZoomEventSingle;

	const DEFAULT_CONFIG: Partial<EChartsConfig> = {
		theme: undefined,
		renderer: 'canvas',
		option: {}
	};
</script>

<script lang="ts">
	let {
		config = DEFAULT_CONFIG,
		option,
		onDataZoom,
		loading = $bindable(false),
		onClear = $bindable()
	}: {
		config?: typeof DEFAULT_CONFIG;
		option: EChartsOption;
		onDataZoom?: (event: DataZoomEventSingle) => void;
		loading?: boolean;
		onClear?: () => void;
	} = $props();

	let { theme, renderer } = config;
	let instance: ECharts;

	const handleDataZoom = (zoomEvent: unknown) => {
		if (!onDataZoom) {
			return;
		}

		const event = zoomEvent as DataZoomEvent;
		let start: number, end: number;

		if (event.batch) {
			const [info] = event.batch;
			start = info.start;
			end = info.end;
		} else {
			start = event.start;
			end = event.end;
		}

		onDataZoom({ start, end });
	};

	function chartAction(element: HTMLElement, echartsConfig: EChartsConfig) {
		const { theme, renderer, option } = {
			...DEFAULT_CONFIG,
			...echartsConfig
		};

		instance = init(element, theme, { renderer });

		const handleResize = () => {
			instance.resize();
		};
		window.addEventListener('resize', handleResize);
		instance.setOption(option);
		instance.on('datazoom', handleDataZoom);

		onClear = () => {
			instance.clear();
		};

		return {
			destroy() {
				instance.off('datazoom', handleDataZoom);
				window.removeEventListener('resize', handleResize);
				instance.dispose();
			},
			update(config: EChartsConfig) {
				instance.setOption({
					...echartsConfig.option,
					...config.option
				});
			}
		};
	}

	$effect(() => {
		if (!instance) return;
		if (loading) instance.showLoading();
		else instance.hideLoading();
	});

	$effect(() => {
		if (!instance || !option) return;
		instance.setOption(option);
	});
</script>

<div id="chart" class="echarts" use:chartAction={{ renderer, theme, option }}></div>

<style>
	.echarts {
		width: 100%;
		height: 100%;
		min-height: 300px;
		position: relative;
		z-index: 1;
		margin-top: 1rem;
	}
</style>
