// Times `TimeSeriesChart` on both backends with N price points: first paint, injected series
// (add / replace / remove) and appending points, plus the JS heap. It serves the production build of
// the sveltecharts demo app and drives its /performance page in headless Chromium.
//
//   pnpm --filter @qtsurfer/sveltecharts exec vite build
//   node scripts/measure-performance.mjs [--sizes 10000,50000,100000] [--runs 5] [--backends lightweight,echarts]
//
// Numbers depend on the machine; compare runs made on the same one. Headless Chromium paints with
// the CPU, so they are on the conservative side of a browser with a GPU.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = new Map(
	process.argv
		.slice(2)
		.flatMap((arg, i, all) => (arg.startsWith('--') ? [[arg.slice(2), all[i + 1]]] : []))
);
const sizes = (args.get('sizes') ?? '10000,50000,100000').split(',').map(Number);
const runs = Number(args.get('runs') ?? 5);
const backends = (args.get('backends') ?? 'lightweight,echarts').split(',');
const PORT = 4199;
const URL = `http://127.0.0.1:${PORT}/performance`;

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};
const ms = (value) => `${Math.round(value)}`;
const mb = (bytes) => (bytes === null ? 'n/a' : (bytes / 1048576).toFixed(0));

async function startServer() {
	const server = spawn(
		'pnpm',
		[
			'--filter',
			'@qtsurfer/sveltecharts',
			'exec',
			'vite',
			'preview',
			'--host',
			'127.0.0.1',
			'--port',
			String(PORT),
			'--strictPort'
		],
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(URL)).ok) return server;
		} catch {
			/* not up yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	server.kill();
	throw new Error('The preview server did not start. Build the demo app first (see the header).');
}

async function measure(browser, backend, count) {
	const page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
	await page.goto(URL);
	await page.waitForFunction(() => window.__perf);
	const call = (fn, ...rest) =>
		page.evaluate(([name, params]) => window.__perf[name](...params), [fn, rest]);

	await call('mount', backend, count); // warm-up: compiles and caches code, not reported
	await call('unmount');

	const created = [];
	const paint = [];
	const allocated = [];
	for (let i = 0; i < runs; i++) {
		const result = await call('mount', backend, count);
		created.push(result.created);
		paint.push(result.paint);
		allocated.push(result.allocated ?? 0);
		if (i < runs - 1) await call('unmount');
	}

	await call('gc');
	const heapChart = await call('heap');
	const steps = { add: [], replace: [], remove: [], append1: [], append1000: [] };
	let heapSeries = null;
	for (let i = 0; i < runs; i++) {
		steps.add.push(await call('addSeries', count));
		if (i === 0) {
			await call('gc');
			heapSeries = await call('heap');
		}
		steps.replace.push(await call('replaceSeries', count, 10 + i));
		steps.remove.push(await call('removeSeries'));
		await call('addSeries', count); // the series the appends extend
		steps.append1.push(await call('append', count, 1));
		await call('revert', count);
		steps.append1000.push(await call('append', count, 1000));
		await call('revert', count);
		await call('removeSeries');
	}
	await page.close();

	const step = (list) =>
		`${ms(median(list.map((x) => x.apply)))} / ${ms(median(list.map((x) => x.paint)))}`;
	return {
		backend,
		points: count,
		'first paint (ms)': ms(median(paint)),
		'create (ms)': ms(median(created)),
		'add series, apply / painted (ms)': step(steps.add),
		'replace series (ms)': step(steps.replace),
		'remove series (ms)': step(steps.remove),
		'append 1 point (ms)': step(steps.append1),
		'append 1000 points (ms)': step(steps.append1000),
		'heap kept, chart (MB)': mb(heapChart),
		'heap kept, chart + 1 series (MB)': mb(heapSeries),
		'heap allocated by an update, max (MB)': mb(
			Math.max(
				...allocated,
				...Object.values(steps)
					.flat()
					.map((x) => x.allocated ?? 0)
			)
		)
	};
}

const server = await startServer();
const browser = await chromium.launch({
	args: ['--enable-precise-memory-info', '--js-flags=--expose-gc']
});
const rows = [];
try {
	for (const backend of backends) {
		for (const count of sizes) {
			process.stderr.write(`${backend} ${count}...\n`);
			rows.push(await measure(browser, backend, count));
		}
	}
} finally {
	await browser.close();
	server.kill();
}
console.log(`Chromium ${browser.version()}, ${runs} runs per cell (median), 1 warm-up run`);
console.table(rows);
