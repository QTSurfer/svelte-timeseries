/**
 * Which of the optional inputs (injected series, injected markers, pane heights) a chart engine can
 * draw. Components call this before applying the input, so an engine that cannot draw something
 * says so once instead of ignoring it silently.
 */
import type { ChartCapabilities, TimeSeriesChartAdapter } from './chartAdapter';

export type InjectedInput = {
	injectedSeries?: readonly unknown[] | null;
	injectedMarkers?: readonly unknown[] | null;
	paneHeights?: Readonly<Record<number, number>> | null;
};

type Feature = {
	/** Name of the component prop. */
	input: keyof InjectedInput;
	/** Adapter member that applies the input. */
	member: 'setInjectedSeries' | 'setInjectedMarkers' | 'setPaneHeights';
	capability: keyof ChartCapabilities;
};

const FEATURES: readonly Feature[] = [
	{ input: 'injectedSeries', member: 'setInjectedSeries', capability: 'injectedSeries' },
	{ input: 'injectedMarkers', member: 'setInjectedMarkers', capability: 'injectedMarkers' },
	{ input: 'paneHeights', member: 'setPaneHeights', capability: 'paneHeights' }
];

function isProvided(value: InjectedInput[keyof InjectedInput]): boolean {
	if (!value) return false;
	return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

/**
 * Whether the adapter can draw a feature. An adapter that reports `capabilities` is trusted (a
 * missing flag means "not supported", as documented on {@link ChartCapabilities}); an adapter
 * without a report is judged by whether the member exists.
 */
function supports(adapter: TimeSeriesChartAdapter, feature: Feature): boolean {
	if (typeof adapter[feature.member] !== 'function') return false;
	return adapter.capabilities ? adapter.capabilities[feature.capability] === true : true;
}

/**
 * One message per input that was given but that `adapter` cannot draw. Empty when everything that
 * was given is supported. `engine` names the engine in the message (the `chartLibrary` value).
 */
export function describeUnsupportedInput(
	adapter: TimeSeriesChartAdapter,
	engine: string,
	input: InjectedInput
): string[] {
	const issues: string[] = [];
	for (const feature of FEATURES) {
		if (isProvided(input[feature.input]) && !supports(adapter, feature)) {
			issues.push(
				`chartLibrary="${engine}" cannot draw "${feature.input}", so it is ignored. ` +
					'Use "echarts" or "lightweight" for injected series, markers and panes.'
			);
		}
	}
	return issues;
}
