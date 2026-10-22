---
"@qtsurfer/sveltecharts": minor
"@qtsurfer/svelte-timeseries": minor
---

Require Svelte 5.55.7 or newer.

The `svelte` peer dependency of both packages is now `^5.55.7` (it was `^5.43.14`). Svelte 5.55.6 and earlier have four cross-site scripting and denial of service issues, in server rendering (`hydratable`, spread attributes), in `<svelte:element>` and through DOM clobbering of the framework's internal state, all fixed in 5.55.7. The components of these packages use none of those features, but they are compiled by the Svelte of your app, so the peer range now keeps those versions out. If you are on an earlier Svelte 5, upgrade with `pnpm add svelte@^5.55.7`.
