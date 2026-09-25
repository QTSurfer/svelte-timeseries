---
"@qtsurfer/sveltecharts": minor
"@qtsurfer/svelte-timeseries": minor
---

Add `@luxalgo/vela` as a third chart engine alongside ECharts and Lightweight Charts.

- `VelaTimeSeriesChartBuilder` implements the `TimeSeriesChartAdapter` contract on top of Vela's headless core: `setCandlestickSeries`, zoom/scroll, and — via a small internal native-indicator overlay — extra line series (`addDimension`) and price-anchored markers (`addMarkerPoint`/`toggleMarkers`/`clearMarkers`), rendered on top of the candlestick. `setDataset` is not supported: Vela's market model always has a single OHLCV base series, not arbitrary multi-dimension datasets.
- `SVEVelaCharts` is the matching Svelte wrapper (mount/resize/theme/destroy), mirroring `SVELightweightCharts`.
- `chartLibrary="vela"` is now selectable on `SvelteTimeSeries`. A table without OHLC data still surfaces a clear, catchable error instead of crashing.

Also fixes two long-standing correctness bugs in `TimeSeriesChartBuilder` (ECharts) that this work surfaced against a real large, sparse dataset:

- `toggleMarkers` no longer throws when a marker was never actually placed (e.g. its value at that timestamp was `null`).
- Markers now render visibly by default (an unset icon no longer maps to ECharts' own "draw nothing" symbol) and anchor to the closest sample with a non-null value, instead of requiring an exact timestamp match — markers come from a separate source than the series they annotate, so an exact match was never guaranteed. The equivalent fix is applied to the new Vela builder as well.
