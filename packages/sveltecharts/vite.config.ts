import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// Svelte resolves to its server build under Node; a test that mounts a component needs the browser one.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		include: ['tests/**/*.{test,spec}.{js,ts}']
	}
});
