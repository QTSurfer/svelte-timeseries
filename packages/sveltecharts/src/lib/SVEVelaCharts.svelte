<script lang="ts">
	import { Vela, type VelaOptions } from '@luxalgo/vela';

	type VelaConfig = {
		options?: Omit<VelaOptions, 'theme'>;
	};

	let {
		onLoad,
		config,
		loading = $bindable(false),
		onClear = $bindable(),
		isDark = false
	}: {
		onLoad: (instance: Vela) => Promise<void>;
		config?: VelaConfig;
		loading?: boolean;
		onClear?: () => void;
		isDark?: boolean;
	} = $props();

	let chart: Vela | undefined;

	const theme = $derived<'dark' | 'light'>(isDark ? 'dark' : 'light');

	function chartAction(element: HTMLElement) {
		chart = new Vela(element, { ...config?.options, theme });

		const handleResize = () => {
			chart?.resize();
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
				chart?.destroy();
			}
		};
	}

	$effect(() => {
		chart?.setTheme(theme);
	});
</script>

<div style="position: relative; width: 100%; height: 100%;">
	<div class="vela-charts" use:chartAction></div>
</div>

<style>
	.vela-charts {
		width: 100%;
		height: 100%;
		min-height: 100px;
		position: relative;
		z-index: 1;
	}
</style>
