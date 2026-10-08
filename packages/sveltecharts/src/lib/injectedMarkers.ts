/**
 * Pure helpers for markers supplied by the host app: normalization, default look per kind,
 * grouping of markers that would otherwise sit on top of each other, and hover hit-testing.
 * Nothing here touches a chart instance.
 */

export type InjectedMarkerKind = 'buy' | 'sell' | 'info';
export type InjectedMarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';

/** An event drawn on the chart, for example a trade or a note produced by a strategy. */
export type InjectedMarker = {
	/** Epoch milliseconds. */
	time: number;
	kind: InjectedMarkerKind;
	/**
	 * Exact price level. When set, the marker is anchored at that price (a buy arrow sits just
	 * under it, a sell arrow just over it). When omitted it is anchored to the bar: buy below the
	 * bar, sell above it.
	 */
	price?: number;
	/** Hover text. It is shown in the tooltip, not drawn on the chart. */
	text?: string;
	/** Any CSS color. Defaults per kind: buy green, sell red, info slate. */
	color?: string;
	/** Defaults per kind: buy `arrowUp`, sell `arrowDown`, info `circle`. */
	shape?: InjectedMarkerShape;
	/** Name of an injected series to attach the marker to. Default: the price series. */
	series?: string;
};

export type MarkerPosition =
	| 'aboveBar'
	| 'belowBar'
	| 'inBar'
	| 'atPriceTop'
	| 'atPriceBottom'
	| 'atPriceMiddle';

export const MARKER_KIND_STYLE: Record<
	InjectedMarkerKind,
	{
		label: string;
		color: string;
		shape: InjectedMarkerShape;
		position: MarkerPosition;
		pricePosition: MarkerPosition;
	}
> = {
	buy: {
		label: 'Buy',
		color: '#16a34a',
		shape: 'arrowUp',
		position: 'belowBar',
		pricePosition: 'atPriceBottom'
	},
	sell: {
		label: 'Sell',
		color: '#dc2626',
		shape: 'arrowDown',
		position: 'aboveBar',
		pricePosition: 'atPriceTop'
	},
	info: {
		label: 'Info',
		color: '#64748b',
		shape: 'circle',
		position: 'aboveBar',
		pricePosition: 'atPriceMiddle'
	}
};

const SHAPES: readonly InjectedMarkerShape[] = ['arrowUp', 'arrowDown', 'circle', 'square'];

/** A marker with every default resolved. */
export type NormalizedMarker = {
	timeMs: number;
	/** Chart time: whole UTC seconds. */
	second: number;
	/** `undefined` for markers that do not come from the injected input (JSON column markers). */
	kind: InjectedMarkerKind | undefined;
	kindLabel: string;
	position: MarkerPosition;
	shape: InjectedMarkerShape;
	color: string;
	price?: number;
	/** Hover text. */
	text?: string;
	/** Text drawn on the chart when the marker stands alone (only JSON column markers use it). */
	chartText?: string;
	size?: number;
	series?: string;
};

export function normalizeInjectedMarkers(input: readonly InjectedMarker[]): {
	markers: NormalizedMarker[];
	issues: string[];
} {
	const markers: NormalizedMarker[] = [];
	const issues: string[] = [];
	let skipped = 0;
	let unknownKinds = 0;

	for (const marker of input) {
		if (!marker || typeof marker.time !== 'number' || !Number.isFinite(marker.time)) {
			skipped++;
			continue;
		}

		const kind: InjectedMarkerKind =
			marker.kind === 'buy' || marker.kind === 'sell' || marker.kind === 'info'
				? marker.kind
				: 'info';
		if (kind !== marker.kind) unknownKinds++;

		const style = MARKER_KIND_STYLE[kind];
		const price =
			typeof marker.price === 'number' && Number.isFinite(marker.price) ? marker.price : undefined;

		markers.push({
			timeMs: marker.time,
			second: Math.floor(marker.time / 1000),
			kind,
			kindLabel: style.label,
			position: price === undefined ? style.position : style.pricePosition,
			shape: marker.shape && SHAPES.includes(marker.shape) ? marker.shape : style.shape,
			color: marker.color || style.color,
			price,
			text: marker.text ? truncate(String(marker.text)) : undefined,
			series: marker.series || undefined
		});
	}

	if (skipped > 0) {
		issues.push(`${skipped} injected marker(s) without a finite "time" were skipped.`);
	}
	if (unknownKinds > 0) {
		issues.push(`${unknownKinds} injected marker(s) had an unknown "kind" and were drawn as info.`);
	}
	return { markers, issues };
}

const MAX_TEXT_LENGTH = 500;

function truncate(text: string): string {
	return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

export type MarkerEntry = {
	kind: InjectedMarkerKind | undefined;
	kindLabel: string;
	text?: string;
	timeMs: number;
	price?: number;
};

/** What is actually drawn: one glyph standing for one or more markers. */
export type MarkerGroup = {
	/** Chart time: whole UTC seconds. */
	second: number;
	/** Earliest marker of the group, in epoch milliseconds. */
	timeMs: number;
	position: MarkerPosition;
	shape: InjectedMarkerShape;
	color: string;
	price?: number;
	size?: number;
	/** Text drawn next to the glyph: `×N` for merged groups, the chart text for a lone marker. */
	label?: string;
	entries: MarkerEntry[];
};

/**
 * Turns markers into the glyphs to draw, sorted by time (the order the chart requires).
 *
 * Rule: markers in the same UTC second with an identical look (position, shape, color and price)
 * are merged into one glyph labeled `×N`; every original marker stays in `entries`, so the hover
 * text lists all of them. Markers in the same second with a different look are kept as separate
 * glyphs, which the chart stacks on the bar. Nothing is dropped.
 */
export function groupMarkers(markers: readonly NormalizedMarker[]): MarkerGroup[] {
	const ordered = markers
		.map((marker, index) => ({ marker, index }))
		.sort((a, b) => a.marker.second - b.marker.second || a.index - b.index);

	const groups: MarkerGroup[] = [];
	let currentSecond = Number.NaN;
	let byLook = new Map<string, MarkerGroup>();

	for (const { marker } of ordered) {
		if (marker.second !== currentSecond) {
			currentSecond = marker.second;
			byLook = new Map();
		}

		const look = `${marker.position}|${marker.shape}|${marker.color}|${marker.price ?? ''}`;
		const entry: MarkerEntry = {
			kind: marker.kind,
			kindLabel: marker.kindLabel,
			text: marker.text,
			timeMs: marker.timeMs,
			price: marker.price
		};

		let group = byLook.get(look);
		if (!group) {
			group = {
				second: marker.second,
				timeMs: marker.timeMs,
				position: marker.position,
				shape: marker.shape,
				color: marker.color,
				price: marker.price,
				size: marker.size,
				label: marker.chartText,
				entries: []
			};
			byLook.set(look, group);
			groups.push(group);
		}
		group.entries.push(entry);
		group.timeMs = Math.min(group.timeMs, marker.timeMs);
		group.label = group.entries.length > 1 ? `×${group.entries.length}` : marker.chartText;
	}

	return groups;
}

/**
 * Groups whose second falls in `[fromSecond, toSecond)`. `groups` must be sorted by second (as
 * returned by {@link groupMarkers}); the search is O(log n + k) so it is cheap to call on every
 * crosshair move.
 */
export function findGroupsInSpan(
	groups: readonly MarkerGroup[],
	fromSecond: number,
	toSecond: number
): MarkerGroup[] {
	let low = 0;
	let high = groups.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (groups[middle].second < fromSecond) low = middle + 1;
		else high = middle;
	}

	const found: MarkerGroup[] = [];
	for (let i = low; i < groups.length && groups[i].second < toSecond; i++) {
		found.push(groups[i]);
	}
	return found;
}

/** One line of the marker hover tooltip. */
export type MarkerHoverItem = {
	kindLabel: string;
	text?: string;
	color: string;
	timeMs: number;
	price?: number;
};

export type MarkerHover = {
	items: MarkerHoverItem[];
	/** Markers beyond `maxItems`, summarized instead of listed. */
	more: number;
};

export function toHoverItems(groups: readonly MarkerGroup[], maxItems = 8): MarkerHover {
	const items: MarkerHoverItem[] = [];
	let total = 0;
	for (const group of groups) {
		for (const entry of group.entries) {
			total++;
			if (items.length < maxItems) {
				items.push({
					kindLabel: entry.kindLabel,
					text: entry.text,
					color: group.color,
					timeMs: entry.timeMs,
					price: entry.price
				});
			}
		}
	}
	return { items, more: total - items.length };
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

/** For backends that render tooltips from HTML strings. */
export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
