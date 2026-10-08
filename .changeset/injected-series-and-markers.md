---
'@qtsurfer/svelte-timeseries': minor
'@qtsurfer/sveltecharts': minor
---

Draw data you already hold: price arrays, your own indicator lines and buy / sell / info markers, without DuckDB.

- New `TimeSeriesChart` component in `@qtsurfer/sveltecharts` and matching props on `SvelteTimeSeries`: `price` (line from `times` / `values` arrays or `[time, value]` pairs), `candles` (from OHLC arrays), `injectedSeries`, `injectedMarkers` and `paneHeights`. Times are epoch milliseconds; plain arrays, typed arrays and `null` / `NaN` gaps are accepted.
- `table` is now optional. Without it the chart is fed from the arrays and DuckDB is never loaded; with it everything works as before and the injected series and markers are drawn on top. DuckDB is now imported on demand.
- Injected series (`name`, `times`, `values`, `color`, `lineWidth`, `lineStyle`, `pane`, `visible`) update in place: they are added, changed and removed by name without recreating the chart or moving the visible time range. `pane` places a series in its own pane (native panes on Lightweight Charts, stacked grids on ECharts) with a shared crosshair and time axis.
- Injected markers (`buy`, `sell`, `info`, with optional `price`, `text`, `color`, `shape` and `series`) get a default look per kind, can attach to a named injected series and show their text on hover.
- Markers in the same UTC second are no longer dropped on Lightweight Charts: markers that look alike merge into one glyph labeled `×N` (all texts stay in the tooltip) and markers that look different are stacked. This also applies to markers from the JSON column.
- Markers now render on candlestick series on both backends.
- `TimeSeriesChartAdapter` gains the optional `setInjectedSeries`, `setInjectedMarkers`, `setPaneHeights` and `capabilities` members. New exported types: `InjectedSeries`, `InjectedMarker`, `PriceLineInput`, `CandlesInput`, `NumericArray`, `ChartCapabilities` and related.
- `SvelteTimeSeries` gains `onChartReady`, and its `debug` prop is now optional.
