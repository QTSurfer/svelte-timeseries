import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/lib/core';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '../../src/lib');
const packageJson = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8'));

const VALUE_IMPORT = /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm;

// Every module the core entry point reaches, following value (not type-only) imports.
function reachedModules(entry: string): Map<string, string[]> {
	const seen = new Map<string, string[]>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop()!;
		if (seen.has(file)) continue;
		const source = readFileSync(resolve(lib, file), 'utf8');
		const specifiers = [...source.matchAll(VALUE_IMPORT)].map((match) => match[1]);
		seen.set(file, specifiers);
		for (const specifier of specifiers) {
			if (specifier.startsWith('.'))
				queue.push(specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts'));
		}
	}
	return seen;
}

describe('the core entry point', () => {
	it('is exported as @qtsurfer/sveltecharts/core with a condition plain Node resolves', () => {
		expect(packageJson.exports['./core']).toEqual({
			types: './dist/core.d.ts',
			default: './dist/core.js'
		});
	});

	it('exports the pure helpers', () => {
		for (const name of [
			'aggregateCandles',
			'resolvePriceData',
			'applyPriceData',
			'priceSignature',
			'normalizeInjectedMarkers',
			'groupMarkers',
			'diffInjectedSeries',
			'toSortedColumns',
			'getPricePrecision',
			'formatPreciseValue',
			'normalizeDecimals'
		]) {
			expect(typeof (core as Record<string, unknown>)[name], name).toBe('function');
		}
	});

	it('works on data without a chart', () => {
		const bars = core.aggregateCandles({ times: [0, 500, 1000, 1500], values: [1, 3, 2, 4] }, '1s');
		expect(bars.times).toEqual([0, 1000]);
		expect(bars.high[0]).toBe(3);
	});

	it('reaches no Svelte file and imports no chart library at run time', () => {
		const modules = reachedModules('core.ts');
		expect(modules.size).toBeGreaterThan(3);
		for (const [file, specifiers] of modules) {
			expect(file).not.toMatch(/\.svelte/);
			for (const specifier of specifiers) {
				// A relative import with the .js extension: Node does not resolve one without it.
				expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\/[A-Za-z]+\.js$/);
			}
		}
	});
});
