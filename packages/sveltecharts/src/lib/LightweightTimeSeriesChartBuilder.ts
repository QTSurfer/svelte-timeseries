import {
	LineSeries,
	createSeriesMarkers,
	type IChartApi,
	type ISeriesApi,
	type ISeriesMarkersPluginApi,
	type LineData,
	type SeriesMarkerBarPosition,
	type SeriesMarker,
	type SeriesMarkerShape,
	type Time,
	type UTCTimestamp
} from 'lightweight-charts';
import type {
	ChartDataset,
	ChartDatasetFormatArray,
	ChartDatasetFormatObject,
	ChartDatasetFormatSimpleObject,
	ChartMarkerPointOptions,
	TimeSeriesChartAdapter
} from './chartAdapter';

type ConfigBuilder = {
	externalManagerLegend?: boolean;
};

type MarkerState = {
	id: number;
	time: Time;
	color: string;
	shape: SeriesMarkerShape;
	position: SeriesMarkerBarPosition;
	text?: string;
	visible: boolean;
	size?: number;
};

const SERIES_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#d97706', '#0891b2'];

export class LightweightTimeSeriesChartBuilder implements TimeSeriesChartAdapter {
	public LightweightChart: IChartApi;
	private builderConfig: ConfigBuilder = {
		externalManagerLegend: false
	};
	private dataset: ChartDatasetFormatSimpleObject = {};
	private yDimensions: string[] = [];
	private yDimensionNames: string[] = [];
	private _tsColumn = '_ts';
	private selected: Record<string, boolean> = {};
	private series = new Map<string, ISeriesApi<'Line', Time>>();
	private markersPlugins = new Map<string, ISeriesMarkersPluginApi<Time>>();
	private markers = new Map<string, MarkerState[]>();
	private _dataDirty = false;
	private _building = false;
	private _timeRangeForced = false;

	constructor(instance: IChartApi, builderConfig?: ConfigBuilder) {
		this.LightweightChart = instance;
		this.builderConfig = { ...this.builderConfig, ...builderConfig };
	}

	setLegendIcon(_icon: string): this {
		return this;
	}

	setDataset(data: ChartDataset, yDimensionsNames?: string[]): this {
		const normalized = this.normalizeDataset(data, yDimensionsNames);

		this.clearSeries();
		this.dataset = normalized.dataset;
		this.yDimensions = normalized.yDimensions;
		this.yDimensionNames = normalized.yDimensionNames;
		this._tsColumn = normalized.tsColumn;
		this.selected = {};
		this._dataDirty = true;

		this.createSeriesData();
		return this.build();
	}

	addDimension(data: ChartDatasetFormatSimpleObject, dimName: string) {
		if (!this.dataset[this._tsColumn]?.length) {
			throw new Error('No source data or dimensions found. Before loading data');
		}

		this.dataset[dimName] = data[dimName];
		this.yDimensions.push(dimName);
		this.yDimensionNames.push(dimName);
		this._dataDirty = true;
		this.addSeries(dimName, dimName, true);

		return this.build();
	}

	addMarkerPoint(
		id: number,
		data: {
			dimName: string;
			timestamp: number;
			name?: string;
		},
		options?: ChartMarkerPointOptions
	): this {
		const markerState: MarkerState = {
			id,
			time: this.toChartTime(data.timestamp),
			color: options?.color ?? '#000000',
			shape: this.mapMarkerShape(options?.icon),
			position: this.mapMarkerPosition(options?.position),
			text: data.name,
			visible: true,
			size: options?.symbolSize ?? 4
		};

		const markers = this.markers.get(data.dimName) ?? [];
		markers.push(markerState);
		this.markers.set(data.dimName, markers);
		this.syncSeriesMarkers(data.dimName);
		return this;
	}

	build() {
		if (this._building) {
			return this;
		}
		this._building = true;

		const visibleLogicalRange = this.LightweightChart.timeScale().getVisibleLogicalRange();
		const rebuildData = this._dataDirty;
		this._dataDirty = false;

		if (rebuildData) {
			for (const dim of this.yDimensions) {
				const series = this.series.get(dim);
				if (!series) {
					continue;
				}
				const lineData = this.toLineData(dim);
				series.setData(lineData);
				series.applyOptions({ visible: this.selected[dim] ?? false });
			}

			if (visibleLogicalRange) {
				this.LightweightChart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
			} else {
				this.LightweightChart.timeScale().fitContent();
				this.forceTimeRangeToDataset();
			}
		}

		for (const dim of this.yDimensions) {
			this.syncSeriesMarkers(dim);
		}

		this._building = false;
		return this;
	}

	getLegendStatus() {
		return this.selected;
	}

	toggleLegend(column: string): this {
		if (!column || !this.series.has(column)) {
			return this;
		}

		const nextVisible = !(this.selected[column] ?? false);
		this.selected[column] = nextVisible;
		this.series.get(column)?.applyOptions({ visible: nextVisible });
		return this;
	}

	goToZoom(start: number, end: number): this {
		const [min, max] = this.getRangeValues();
		if (!min && !max) {
			return this;
		}

		if (start <= 0 && end >= 100) {
			this.LightweightChart.timeScale().fitContent();
			return this;
		}

		const width = max - min;
		const from = min + width * (start / 100);
		const to = min + width * (end / 100);

		this.LightweightChart.timeScale().setVisibleRange({
			from: this.toChartTime(from),
			to: this.toChartTime(to)
		});

		return this;
	}

	scrollToTime(timestamp: number): this {
		const timeSec = this.toChartTime(timestamp);
		const timeScale = this.LightweightChart.timeScale();
		const visibleRange = timeScale.getVisibleRange();

		if (!visibleRange) {
			timeScale.setVisibleRange({ from: timeSec, to: (timeSec + 60) as Time });
			return this;
		}

		const width = Number(visibleRange.to) - Number(visibleRange.from);
		const halfWidth = Math.max(width / 2, 30);

		timeScale.setVisibleRange({
			from: (timeSec - halfWidth) as Time,
			to: (timeSec + halfWidth) as Time
		});

		return this;
	}

	getTotalRows() {
		return this.dataset[this._tsColumn]?.length ?? 0;
	}

	getRangeValues(): [number, number] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		if (!timestamps.length) {
			return [0, 0];
		}
		return [timestamps[0], timestamps[timestamps.length - 1]];
	}

	toggleMarkers(id: number, dimName: string, shape: string) {
		const markers = this.markers.get(dimName);
		if (!markers) {
			return this;
		}

		const marker = markers.find((item) => item.id === id);
		if (!marker) {
			return this;
		}

		marker.visible = !marker.visible;
		if (marker.visible) {
			marker.shape = this.mapMarkerShape(shape);
		}
		this.syncSeriesMarkers(dimName);
		return this;
	}

	clearMarkers(): this {
		this.markers.clear();
		for (const plugin of this.markersPlugins.values()) {
			plugin.setMarkers([]);
		}
		return this;
	}

	private normalizeDataset(data: ChartDataset, yDimensionsNames?: string[]) {
		if (Array.isArray(data)) {
			if (!data.length || Array.isArray(data[0])) {
				return this.normalizeMatrix(data as ChartDatasetFormatArray, yDimensionsNames);
			}
			return this.normalizeObjectArray(data as ChartDatasetFormatObject, yDimensionsNames);
		}

		return this.normalizeSimpleObject(data, yDimensionsNames);
	}

	private normalizeSimpleObject(data: ChartDatasetFormatSimpleObject, yDimensionsNames?: string[]) {
		const keys = Object.keys(data);
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		if (yDimensionsNames?.length && yDimensionsNames.length !== keys.length + 1) {
			throw new Error(
				`Dimensions length ${yDimensionsNames.length} does not match total columns ${keys.length + 1}.`
			);
		}

		return {
			tsColumn,
			dataset: data,
			yDimensions: keys,
			yDimensionNames: yDimensionsNames?.length ? yDimensionsNames.slice(1) : keys
		};
	}

	private normalizeObjectArray(data: ChartDatasetFormatObject, yDimensionsNames?: string[]) {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		const keys = Object.keys(data[0]);
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		const dataset: ChartDatasetFormatSimpleObject = {
			[tsColumn]: data.map((row) => Number(row[tsColumn]))
		};

		for (const key of keys) {
			dataset[key] = data.map((row) => Number(row[key]));
		}

		return {
			tsColumn,
			dataset,
			yDimensions: keys,
			yDimensionNames: yDimensionsNames?.length ? yDimensionsNames.slice(1) : keys
		};
	}

	private normalizeMatrix(data: ChartDatasetFormatArray, yDimensionsNames?: string[]) {
		if (data.length < 2) {
			throw new Error('Minimum data length is 2.');
		}

		if (!yDimensionsNames?.length) {
			throw new Error('Requires yDimensionsNames. e.g. ["v1", "v2", "v3"]');
		}

		const keys = [...yDimensionsNames];
		const tsColumn = keys.shift();
		if (!tsColumn) {
			throw new Error('No time dimension found.');
		}

		const totalCol = data[0]?.length ?? 0;
		if (totalCol !== yDimensionsNames.length) {
			throw new Error(
				`Dimensions length ${yDimensionsNames.length} does not match total columns ${totalCol}.`
			);
		}

		const dataset: ChartDatasetFormatSimpleObject = {
			[tsColumn]: data.map((row) => Number(row[0]))
		};

		keys.forEach((key, index) => {
			dataset[key] = data.map((row) => Number(row[index + 1]));
		});

		return {
			tsColumn,
			dataset,
			yDimensions: keys,
			yDimensionNames: keys
		};
	}

	private createSeriesData() {
		if (!this.yDimensions.length || !this.yDimensionNames.length) {
			throw new Error('No dimensions found.');
		}

		if (this.yDimensions.length !== this.yDimensionNames.length) {
			throw new Error(
				`Dimensions length ${this.yDimensionNames.length} does not match total columns ${this.yDimensions.length}.`
			);
		}

		this.syncPriceScales();
		this.yDimensions.forEach((dim, index) => {
			const isSelected =
				(this.yDimensions.length > 1 && dim === 'price') || this.yDimensions.length === 1;
			this.addSeries(dim, this.yDimensionNames[index], isSelected, index);
		});
	}

	private addSeries(dim: string, dimName: string, isSelected: boolean, index?: number) {
		const series = this.LightweightChart.addSeries(LineSeries, {
			color: SERIES_COLORS[(index ?? this.series.size) % SERIES_COLORS.length],
			lineWidth: 1,
			title: dimName,
			priceScaleId: this.isPercentageDimension(dim) ? 'left' : 'right',
			visible: isSelected,
			crosshairMarkerVisible: false,
			lastValueVisible: true
		});

		this.series.set(dim, series);
		this.selected[dim] = isSelected;
		this.markersPlugins.set(dim, createSeriesMarkers(series, []));
	}

	private syncSeriesMarkers(dimName: string) {
		const plugin = this.markersPlugins.get(dimName);
		if (!plugin) {
			return;
		}

		// Lightweight Charts requires unique timestamps per series — duplicate UTCTimestamps
		// within the same second are collapsed, keeping only the first marker at that time.
		const seenTimes = new Set<number>();
		const markers = (this.markers.get(dimName) ?? [])
			.filter((marker) => marker.visible)
			.sort((a, b) => (a.time as number) - (b.time as number))
			.filter((marker) => {
				const t = marker.time as number;
				if (seenTimes.has(t)) return false;
				seenTimes.add(t);
				return true;
			})
			.map(
				(marker): SeriesMarker<Time> => ({
					time: marker.time,
					color: marker.color || '#888888',
					shape: marker.shape,
					position: marker.position,
					size: marker.size,
					...(marker.text ? { text: marker.text } : {})
				})
			);

		plugin.setMarkers(markers);

		if (markers.length > 0) {
			this.expandTimeRangeForMarkers();
		}
	}

	private expandTimeRangeForMarkers() {
		const timeScale = this.LightweightChart.timeScale();
		const visibleRange = timeScale.getVisibleRange();

		if (!visibleRange) {
			return;
		}

		let minTime = visibleRange.from as number;
		let maxTime = visibleRange.to as number;

		for (const [, markerList] of this.markers) {
			for (const m of markerList) {
				const t = m.time as number;
				if (t < minTime) minTime = t;
				if (t > maxTime) maxTime = t;
			}
		}

		if (minTime < (visibleRange.from as number) || maxTime > (visibleRange.to as number)) {
			const padding = (maxTime - minTime) * 0.1;
			timeScale.setVisibleRange({
				from: (minTime - padding) as Time,
				to: (maxTime + padding) as Time
			});
		}
	}

	private clearSeries() {
		for (const plugin of this.markersPlugins.values()) {
			plugin.detach();
		}

		for (const series of this.series.values()) {
			this.LightweightChart.removeSeries(series);
		}

		this.series.clear();
		this.markersPlugins.clear();
		this.markers.clear();
		this._timeRangeForced = false;
		this._building = false;
	}

	private toLineData(dim: string): LineData<Time>[] {
		const timestamps = this.dataset[this._tsColumn] ?? [];
		const values = this.dataset[dim] ?? [];

		if (timestamps.length === 0) {
			return [];
		}

		const seen = new Set<number>();
		const result: LineData<Time>[] = [];

		for (let i = 0; i < timestamps.length; i++) {
			const t = this.toChartTime(timestamps[i]);
			const tNum = t as number;
			if (seen.has(tNum)) continue;
			seen.add(tNum);
			result.push({ time: t, value: values[i] });
		}

		return result;
	}

	private toChartTime(timestamp: number): UTCTimestamp {
		return Math.floor(timestamp / 1000) as UTCTimestamp;
	}

	private forceTimeRangeToDataset() {
		if (this._timeRangeForced) {
			return;
		}
		this._timeRangeForced = true;

		const timestamps = this.dataset[this._tsColumn] ?? [];
		if (timestamps.length === 0) {
			return;
		}

		let minMs = timestamps[0];
		let maxMs = timestamps[0];
		for (let i = 1; i < timestamps.length; i++) {
			const t = timestamps[i];
			if (t < minMs) minMs = t;
			if (t > maxMs) maxMs = t;
		}

		const minSec = this.toChartTime(minMs);
		const maxSec = this.toChartTime(maxMs);

		this.LightweightChart.timeScale().setVisibleRange({
			from: minSec,
			to: maxSec
		});
	}

	private isPercentageDimension(dim: string) {
		return !dim.startsWith('_') && dim.endsWith('%');
	}

	private syncPriceScales() {
		const hasPercentageSeries = this.yDimensions.some((dim) => this.isPercentageDimension(dim));
		const hasValueSeries = this.yDimensions.some((dim) => !this.isPercentageDimension(dim));

		this.LightweightChart.applyOptions({
			leftPriceScale: {
				visible: hasPercentageSeries
			},
			rightPriceScale: {
				visible: hasValueSeries
			}
		});
	}

	private mapMarkerShape(shape?: string): SeriesMarkerShape {
		if (shape === 'circle' || shape === 'arrowUp' || shape === 'arrowDown') {
			return shape;
		}

		if (shape === 'none') {
			return 'circle';
		}

		return 'square';
	}

	private mapMarkerPosition(position?: string): SeriesMarkerBarPosition {
		if (position === 'inside') {
			return 'inBar';
		}

		if (position === 'aboveBar' || position === 'belowBar' || position === 'inBar') {
			return position;
		}

		return 'aboveBar';
	}
}
