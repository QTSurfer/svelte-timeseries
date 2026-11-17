---
"@qtsurfer/sveltecharts": minor
"@qtsurfer/svelte-timeseries": minor
---

New `timeZone` prop: `'utc'` (the default, nothing changes) or `'local'`, to write the time axis, the crosshair label and the tooltip on the viewer's own clock.

- **Where.** `TimeSeriesChart` and `SvelteTimeSeries` (`timeZone`), and `SVELightweightCharts` for those who mount it themselves. It works with the ECharts and Lightweight Charts engines; Vela stays UTC. Changing it builds a new chart (`SVELightweightCharts` calls `onLoad` again with it): the engine cannot take a time formatter away from a chart that has one.
- **ECharts.** With `'local'` the chart turns its `useUTC` off and the time-axis labels read the viewer's clock. `formatAxisTime` takes the time zone as a second argument (default `'utc'`).
- **Lightweight Charts.** The engine writes its axis and crosshair in UTC and has no time zone option, so with `'local'` the component gives it a `tickMarkFormatter` and a `localization.timeFormatter`. The tooltip's time was fixed to UTC in the component: it follows `timeZone` now. A tick of the axis is only named for its day, month or year when it is at the start of one on the viewer's clock (the engine puts those on UTC boundaries), and otherwise says what time it is. A formatter passed in `lightweightOptions` still wins.
- The default does not change: UTC, in the same format as before (`YYYY-MM-DD HH:MM:SS` in the tooltip, `HH:MM:SS` on the ECharts axis).
