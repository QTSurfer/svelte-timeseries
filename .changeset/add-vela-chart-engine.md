---
'@qtsurfer/sveltecharts': minor
---

Add `@luxalgo/vela` as a third candlestick chart engine alongside ECharts and Lightweight Charts. `VelaTimeSeriesChartBuilder` implements the candlestick-oriented slice of `TimeSeriesChartAdapter` (setCandlestickSeries, zoom/scroll, markers), and `SVEVelaCharts` is the matching Svelte wrapper. Vela renders a single OHLCV market rather than arbitrary multi-dimension line series, so `setDataset`/`addDimension` are not supported on this builder.
