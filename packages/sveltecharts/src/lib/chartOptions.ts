/**
 * Merging of the options an app passes to the Lightweight Charts engine into the defaults of the
 * component. Pure: it touches no chart instance.
 */

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `layout.attributionLogo` is not configurable here: the TradingView attribution stays on.
 * Everything else the app passes is merged one object level at a time, so
 * `{ layout: { background: {...} } }` changes the background and keeps the text color of the
 * defaults (a shallow merge would replace the whole `layout` object).
 */
export function mergeChartOptions<T extends object>(base: T, extra: object | undefined): T {
	if (!extra) return base;
	return mergeInto(base as PlainObject, extra as PlainObject, true) as T;
}

function mergeInto(base: PlainObject, extra: PlainObject, topLevel: boolean): PlainObject {
	const result: PlainObject = { ...base };
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined) continue;
		if (topLevel && key === 'layout' && isPlainObject(value)) {
			const { attributionLogo: _kept, ...layout } = value;
			void _kept;
			result[key] = isPlainObject(result[key]) ? mergeInto(result[key], layout, false) : layout;
			continue;
		}
		result[key] =
			isPlainObject(value) && isPlainObject(result[key])
				? mergeInto(result[key], value, false)
				: value;
	}
	return result;
}
