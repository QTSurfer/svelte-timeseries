<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '@iconify/svelte';

	// Top bar shared by the demo pages. `current` swaps the link to the page you are on for a way back.
	let { current = 'home' }: { current?: 'home' | 'injected' } = $props();
</script>

<div class="navbar shadow-sm bg-primary">
	<div class="navbar-start text-primary-content">
		<div class="flex gap-2 items-baseline text-2xl font-bold">
			SvelteTimeSeries <span class="font-extralight text-sm">DEMO</span>
		</div>
	</div>

	<div class="navbar-center gap-4">
		<a
			href={resolve('/markers-format')}
			class="btn btn-sm btn-ghost text-primary-content gap-2 hover:bg-primary-content/15 hover:text-primary-content"
		>
			<Icon icon="mdi:map-marker-outline" width="1.1em" height="1.1em" />
			Markers Format
		</a>
		{#if current === 'injected'}
			<a class="link text-primary-content" href={resolve('/')} data-testid="home-demo-link"
				>&larr; Back to the demo</a
			>
		{:else}
			<a
				class="link text-primary-content"
				href={resolve('/injected')}
				data-testid="injected-demo-link">Your own arrays, series and markers</a
			>
		{/if}
	</div>
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
