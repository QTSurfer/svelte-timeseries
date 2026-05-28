---
"@qtsurfer/svelte-timeseries": patch
"@qtsurfer/sveltecharts": patch
---

Fix Tailwind v4 incorrectly parsing distributed Svelte files as CSS.

`SVECharts.svelte`: moved `init` and `use` echarts imports and component registration into a separate `echartsSetup.ts` module so the `.svelte` file no longer contains destructured imports that Tailwind's CSS parser misreads as CSS declarations.

`SvelteTimeSeries.svelte`: added an empty `<script lang="ts" module>` block so Tailwind v4 recognizes the file as a Svelte component instead of treating the entire file as a CSS document.
