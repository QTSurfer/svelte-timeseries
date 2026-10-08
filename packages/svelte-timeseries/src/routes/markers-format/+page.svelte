<script lang="ts">
	import '../../css/main.css';
	import Icon from '@iconify/svelte';
	import { resolve } from '$app/paths';

	type IconEntry = {
		value: string;
		iconifyIcon: string;
		echarts: string;
		lightweight: string;
	};

	// The four shapes lightweight-charts natively supports (its own SeriesMarkerShape type),
	// plus 'none' — these render consistently across ECharts and Lightweight. See
	// @qtsurfer/sveltecharts' ChartMarkerPointOptions.icon doc comment for the source of truth.
	const consistentIcons: IconEntry[] = [
		{ value: 'circle', iconifyIcon: 'mdi:circle', echarts: 'native', lightweight: 'native' },
		{
			value: 'square',
			iconifyIcon: 'mdi:square',
			echarts: "maps to 'rect'",
			lightweight: 'native'
		},
		{
			value: 'arrowUp',
			iconifyIcon: 'mdi:arrow-up-bold',
			echarts: 'native',
			lightweight: 'native'
		},
		{
			value: 'arrowDown',
			iconifyIcon: 'mdi:arrow-down-bold',
			echarts: 'native',
			lightweight: 'native'
		},
		{
			value: 'none',
			iconifyIcon: 'mdi:help-circle-outline',
			echarts: "falls back to 'circle'",
			lightweight: "falls back to 'circle'"
		}
	];

	// ECharts' own extra native symbols — render distinctly there, but have no Lightweight
	// equivalent, so they collapse to 'square' (the closest visual approximation).
	const echartsOnlyIcons: IconEntry[] = [
		{
			value: 'rect',
			iconifyIcon: 'mdi:rectangle',
			echarts: 'native',
			lightweight: "collapses to 'square'"
		},
		{
			value: 'roundRect',
			iconifyIcon: 'mdi:square-rounded',
			echarts: 'native',
			lightweight: "collapses to 'square'"
		},
		{
			value: 'triangle',
			iconifyIcon: 'mdi:triangle',
			echarts: 'native',
			lightweight: "collapses to 'square'"
		},
		{
			value: 'diamond',
			iconifyIcon: 'mdi:rhombus',
			echarts: 'native',
			lightweight: "collapses to 'square'"
		},
		{
			value: 'pin',
			iconifyIcon: 'mdi:map-marker',
			echarts: 'native',
			lightweight: "collapses to 'square'"
		}
	];
</script>

<svelte:head>
	<title>Markers Format — SvelteTimeSeries</title>
</svelte:head>

<div class="min-h-screen bg-base-200">
	<div class="navbar shadow-sm bg-primary">
		<div class="navbar-start text-primary-content">
			<a
				href={resolve('/')}
				class="btn btn-sm btn-ghost text-primary-content gap-2 hover:bg-primary-content/15 hover:text-primary-content"
			>
				<Icon icon="mdi:arrow-left" width="1.1em" height="1.1em" />
				Back to demo
			</a>
		</div>
		<div class="navbar-center text-primary-content font-bold">Markers Format</div>
		<div class="navbar-end"></div>
	</div>

	<div class="max-w-4xl mx-auto px-4 py-8">
		<h1 class="text-2xl font-bold mb-2">Marker icon reference</h1>
		<p class="text-base-content/70 mb-6">
			<code class="bg-base-300 rounded px-1">addMarkerPoint</code>'s
			<code class="bg-base-300 rounded px-1">icon</code> option accepts any of these values. Only
			the five below are <strong>guaranteed to render the same shape</strong> in ECharts, Lightweight
			Charts and Vela — lightweight-charts' own native marker-shape set is the narrowest of the engines,
			so it's the common denominator the others map onto.
		</p>
		<p class="text-base-content/70 mb-8">
			<strong>Vela</strong> draws <code class="bg-base-300 rounded px-1">circle</code> natively and
			builds <code class="bg-base-300 rounded px-1">square</code>,
			<code class="bg-base-300 rounded px-1">arrowUp</code> and
			<code class="bg-base-300 rounded px-1">arrowDown</code> as filled polygons. Any other value, or
			none, is a plain circle there, so the ECharts-only extras below are not distinct on Vela.
		</p>
		<h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
			<span class="badge badge-success badge-sm"></span>
			ECharts &amp; Lightweight: consistent
		</h2>
		<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-10">
			{#each consistentIcons as entry (entry.value)}
				<div class="card bg-base-100 shadow-sm">
					<div class="card-body items-center text-center p-4 gap-2">
						<Icon icon={entry.iconifyIcon} width="2.2em" height="2.2em" />
						<code class="text-sm font-semibold">{entry.value}</code>
						<div class="text-xs text-base-content/60 leading-snug">
							<div>ECharts: {entry.echarts}</div>
							<div>Lightweight: {entry.lightweight}</div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
			<span class="badge badge-warning badge-sm"></span>
			ECharts-only extras
		</h2>
		<p class="text-sm text-base-content/60 mb-3">
			These render as distinct shapes in ECharts, but not in Lightweight — use them only where
			engine parity doesn't matter.
		</p>
		<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
			{#each echartsOnlyIcons as entry (entry.value)}
				<div class="card bg-base-100 shadow-sm">
					<div class="card-body items-center text-center p-4 gap-2">
						<Icon icon={entry.iconifyIcon} width="2.2em" height="2.2em" />
						<code class="text-sm font-semibold">{entry.value}</code>
						<div class="text-xs text-base-content/60 leading-snug">
							<div>ECharts: {entry.echarts}</div>
							<div>Lightweight: {entry.lightweight}</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
