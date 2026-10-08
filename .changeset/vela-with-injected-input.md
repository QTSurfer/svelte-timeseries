---
'@qtsurfer/sveltecharts': minor
'@qtsurfer/svelte-timeseries': minor
---

Vela next to the arrays entry, injected series and injected markers.

- `TimeSeriesChart` (and `SvelteTimeSeries` without a `table`) accepts `chartLibrary="vela"` for `candles`. Vela is loaded on demand there, so the other engines never download it. A `price` line is rejected with a visible message.
- The Vela builder declares its `capabilities` (all `false`): it does not draw injected series, injected markers or panes. The components now log one warning per ignored input (`injectedSeries`, `injectedMarkers`, `paneHeights`) instead of dropping it silently. New export `describeUnsupportedInput(adapter, engine, input)` returns those messages.
- A marker's target column in an OHLC table is no longer loaded as an extra line when it is one of open / high / low / close: the markers stay on the candles on every engine.
- An unset marker icon draws a circle on Lightweight Charts too (it was a square), as on ECharts and Vela.
- `clearMarkers()` on ECharts leaves the injected markers alone, as on Lightweight Charts.
