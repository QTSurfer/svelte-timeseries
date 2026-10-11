<script lang="ts" module>
	export type DemoPage =
		| '/'
		| '/series'
		| '/object'
		| '/candlestick'
		| '/injected'
		| '/performance';
</script>

<script lang="ts">
	import { resolve } from '$app/paths';

	// Links between the demo pages. The page you are on is marked and is not a link to itself.
	let { current }: { current: DemoPage } = $props();

	const pages: { path: DemoPage; id: string; label: string }[] = [
		{ path: '/', id: 'home', label: 'Array data' },
		{ path: '/series', id: 'series', label: 'Series data' },
		{ path: '/object', id: 'object', label: 'Object data' },
		{ path: '/candlestick', id: 'candlestick', label: 'Candlestick' },
		{ path: '/injected', id: 'injected', label: 'Arrays, series and markers' },
		{ path: '/performance', id: 'performance', label: 'Performance' }
	];
</script>

<nav class="demo-nav" aria-label="Demo pages">
	{#each pages as page (page.path)}
		{#if page.path === current}
			<span aria-current="page" data-testid={`nav-${page.id}`}>{page.label}</span>
		{:else}
			<a href={resolve(page.path)} data-testid={`nav-${page.id}`}>{page.label}</a>
		{/if}
	{/each}
</nav>

<style>
	.demo-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin-bottom: 1rem;
		font-size: 0.9375rem;
	}

	a {
		color: #2563eb;
		text-decoration: underline;
	}

	span {
		font-weight: 600;
		color: #0f172a;
	}
</style>
