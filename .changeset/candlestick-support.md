---
"@qtsurfer/svelte-timeseries": major
"@qtsurfer/sveltecharts": major
---

Add candlestick (OHLC) chart support.

- Auto-detects OHLC columns by name (`open/_open/opn`, `high/_high/hig`, `low/_low`, `close/_close/cls`). Single-letter aliases (`o/h/l/c`) require explicit mapping to avoid false positives on unrelated parquets.
- Explicit mapping via `candlestick: { open, high, low, close }` in table config.
- Set `candlestick: false` to force line rendering and skip detection.
- `resolution` option resamples raw ticks into fixed-size OHLC bars via DuckDB `time_bucket()` (e.g. `'15m'`, `'1h'`).
- New exports: `OHLCColumns`, `OHLCResolution`, `TimeSeriesChartAdapter`, `OHLCDimensions`.
- `TimeSeriesFacade.getChartAdapter()` returns the backend-agnostic adapter interface.
- **Breaking**: `TimeSeriesFacade.getChartBuilder()` now returns `TimeSeriesChartBuilder | undefined` (returns `undefined` when the Lightweight Charts backend is active). Use `getChartAdapter()` for backend-agnostic access.
- Fix: `addDimension` crashed with `Cannot read properties of undefined (reading 'push')` when called after `setCandlestickSeries`.
