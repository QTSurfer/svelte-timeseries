<script lang="ts" context="module">
	import * as echarts from 'echarts/core';
	import { LineChart } from 'echarts/charts';
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
	import type { EChartsOption } from 'echarts/types/dist/option';
	import type { ECharts } from 'echarts/types/dist/core';
	// Register the required components
	echarts.use([
		LineChart,
		DataZoomComponent,
		LegendComponent,
		TitleComponent,
		TooltipComponent,
		GridComponent,
		DatasetComponent,
		LabelLayout,
		CanvasRenderer
	]);

	export type { EChartsOption };
	export type EChartsTheme = string | object;
	export type EChartsRenderer = 'canvas' | 'svg';

	export type EChartsConfig = {
		theme?: EChartsTheme;
		renderer?: EChartsRenderer;
		option: EChartsOption;
	};

	export type DataRange = {
		start: number;
		end: number;
	};
	export type DataZoomEvent = CustomEvent<DataRange>;

	const DEFAULT_CONFIG: Partial<EChartsConfig> = {
		theme: undefined,
		renderer: 'canvas'
	};
</script>

<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	export let option: EChartsOption;
	export let { theme, renderer } = DEFAULT_CONFIG;

	let instance: ECharts;
	const dispatch = createEventDispatcher();
	const handleDataZoom = (event: any) => {
		let start, end;
		if (event.batch) {
			const [info] = event.batch;
			start = info.start;
			end = info.end;
		} else {
			start = event.start;
			end = event.end;
		}
		dispatch('datazoom', { event, start, end });
	};

	export function chartAction(element: HTMLElement, echartsConfig: EChartsConfig) {
		const { theme, renderer, option } = {
			...DEFAULT_CONFIG,
			...echartsConfig
		};
		instance = echarts.init(element, theme, { renderer });

		const handleResize = () => {
			instance.resize();
		};
		window.addEventListener('resize', handleResize);
		instance.setOption(option);
		instance.on('datazoom', handleDataZoom);

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
	export function showLoading(text?: string) {
		instance.showLoading({ text: text || '' });
	}

	export function hideLoading() {
		instance.hideLoading();
	}
</script>

<div id="chart" class="echarts" use:chartAction={{ renderer, theme, option }}></div>

<style>
	.echarts {
		width: 100%;
		height: 75vh;
	}
</style>
