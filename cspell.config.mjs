import fs from 'node:fs';
import path from 'node:path';

const wordsFile = path.resolve('./cspell-project-words.txt');

/**
 * Supports simple optional groups:
 * backtest(s)
 * indicator(s)
 *
 * Only one (...) group per line.
 */
function expandPattern(word) {
	const match = word.match(/^(.*)\(([^)]+)\)(.*)$/);
	if (!match) return [word];
	const [, before, optional, after] = match;
	return [`${before}${after}`, `${before}${optional}${after}`];
}

function loadWords() {
	if (!fs.existsSync(wordsFile)) return [];
	const lines = fs
		.readFileSync(wordsFile, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));
	return [...new Set(lines.flatMap(expandPattern))];
}

export default {
	$schema: 'https://raw.githubusercontent.com/streetsidesoftware/cspell/main/cspell.schema.json',
	version: '0.2',

	language: 'en',
	languageId: 'typescript,svelte,javascript,markdown,json',
	caseSensitive: false,
	allowCompoundWords: false,
	useGitignore: true,

	words: loadWords(),

	ignorePaths: [
		'node_modules',
		'dist',
		'.svelte-kit',
		'build',
		'coverage',
		'.changeset',
		'pnpm-lock.yaml',
		'cspell-project-words.txt',
		'samples'
	],

	overrides: [
		{
			filename: '**/*.{ts,svelte,js}',
			language: 'en'
		}
	]
};
