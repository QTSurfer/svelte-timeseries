---
'@qtsurfer/svelte-timeseries': patch
'@qtsurfer/sveltecharts': patch
---

Make chart load failures visible and recoverable.

- `SvelteTimeSeries` now catches a failure of the on-demand DuckDB import and of `DuckDB.create` too: it shows the load error instead of staying in the loading state forever. A failed load also clears the previous facade, columns and markers instead of leaving a stale chart behind the error.
- `onFacadeReady` and `onChartReady` run after the load completes, so an error thrown by your callback is no longer reported as "failed to load" over a chart that did load.
- The Vela overlay no longer stays blocked when a remount fails: the error is rethrown and the next overlay change retries the mount.
