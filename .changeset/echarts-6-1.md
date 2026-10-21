---
"@qtsurfer/sveltecharts": minor
"@qtsurfer/svelte-timeseries": minor
---

Require ECharts 6.1.0 or newer.

The `echarts` peer dependency of `@qtsurfer/sveltecharts` is now `^6.1.0` (it was `^6.0.0`). ECharts 6.0.x renders the `name` of a Lines series datum into its default tooltip without escaping it, a cross-site scripting issue fixed in 6.1.0. The charts of this package do not use Lines series, but your app may draw them on the same ECharts. If you are on 6.0.x, upgrade with `pnpm add echarts@^6.1.0`.
