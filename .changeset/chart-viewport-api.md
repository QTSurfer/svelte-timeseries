---
"@qtsurfer/svelte-timeseries": minor
"@qtsurfer/sveltecharts": minor
---

Viewport API for the Lightweight Charts engine, and a fit-all that shows the whole range.

- `TimeSeriesChartAdapter` gains `onCrosshairMove`, `onVisibleRangeChange`, `setVisibleRange(fromMs, toMs)` and `fitContent()`. Lightweight Charts implements them; check the new `capabilities.crosshairEvents`, `capabilities.visibleRangeEvents` and `capabilities.viewport` flags before calling them. ECharts and Vela do not report these yet.
- `TimeSeriesChart` accepts `onCrosshairMove` and `onVisibleRangeChange` props, and a `resetView` prop: change its value to show all the data again, for example when a new run replaces the arrays under the same series name. New arrays alone keep the current view.
- Lightweight Charts accepts a bar spacing down to 0.001 px, so `fitContent` shows a dense series (100k ticks over 14 hours) in full. A new dataset passed to `setDataset` also resets the view to all of it.
- New exported types: `CrosshairMoveEvent` and `TimeRangeMs`.
