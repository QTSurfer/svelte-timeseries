<script lang="ts" module>
	import { init, use } from 'echarts/core';
	import { LineChart, BarChart } from 'echarts/charts';
	import {
		DataZoomComponent,
		LegendComponent,
		TitleComponent,
		TooltipComponent,
		GridComponent,
		DatasetComponent,
		MarkLineComponent,
		MarkPointComponent,
		MarkAreaComponent
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
		CanvasRenderer,
		MarkLineComponent,
		MarkPointComponent,
		MarkAreaComponent
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

	const DEFAULT_CONFIG: EChartsConfig = {
		theme: undefined,
		renderer: 'canvas',
		option: {}
	};
</script>

<script lang="ts">
	let {
		onLoad,
		config,
		onDataZoom,
		loading = $bindable(false),
		onClear = $bindable(),
		isDark = false
	}: {
		onLoad: (instance: ECharts) => Promise<void>;
		config?: Partial<EChartsConfig>;
		onDataZoom?: (event: DataZoomEventSingle) => void;
		loading?: boolean;
		onClear?: () => void;
		isDark?: boolean;
	} = $props();

	let instance: ECharts;

	const { theme, renderer, option } = {
		...DEFAULT_CONFIG,
		...config
	};

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

	function chartAction(element: HTMLElement) {
		instance = init(element, undefined, { renderer });

		const handleResize = () => {
			instance.resize();
		};
		window.addEventListener('resize', handleResize);
		instance.on('datazoom', handleDataZoom);

		if (Object.keys(option).length) {
			instance.setOption(option);
		}

		onClear = () => instance.clear();

		onLoad(instance);

		return {
			destroy() {
				instance.off('datazoom', handleDataZoom);
				window.removeEventListener('resize', handleResize);
				instance.dispose();
			}
			/**
			 * @todo
			 * Limiting option assignment. Review implementation
			 */
			// update(config: EChartsConfig) {
			// 	instance.setOption({
			// 		...echartsConfig.option,
			// 		...config.option
			// 	});
			// }
		};
	}

	$effect(() => {
		if (instance) {
			instance.setTheme({ backgroundColor: isDark ? '#100c2a' : '#fff' });
		}
	});
</script>

<div style="position: relative; width: 100%; height: 100%;">
	<div id="chart" class="echarts" use:chartAction></div>
</div>

<style>
	.echarts {
		width: 100%;
		height: 100%;
		min-height: 300px;
		position: relative;
		z-index: 1;
	}
</style>
