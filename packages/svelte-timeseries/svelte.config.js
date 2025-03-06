import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
const REPO_NAME = 'svelte-timeseries';
const dev = process.argv.includes('dev');
/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			fallback: 'index.html',
			strict: false
		}),
		paths: {
			base: dev ? '' : `/${REPO_NAME}`
		},
		prerender: {
			entries: ['*']
		}
	}
};

export default config;
