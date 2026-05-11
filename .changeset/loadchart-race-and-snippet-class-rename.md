---
"@qtsurfer/svelte-timeseries": minor
---

💥 **Breaking:** the `snippetclass` prop on `<SvelteTimeSeries>` is renamed to `snippetClass` to match the camelCase convention already used by `containerClass` and `chartClass`. Consumers must rename the prop where they use it.

🐛 **Fix:** `<SvelteTimeSeries>` no longer crashes with `TypeError: Cannot read properties of undefined (reading 'mainColumn')` when the `table` prop mutates during the async DuckDB initialization. The table snapshot is now captured before the `await`, and concurrent `loadChart` invocations (triggered by `chartLibrary` / `isDark` remounts or prop changes) abort safely and close any orphan DuckDB connections.

🧹 **Internal:** introduce a `cspell`-based spellcheck (`pnpm spellcheck`) and clean up identifier typos that surfaced — `ColumsSchema` → `ColumnsSchema`, `columnesSelect` → `columnsSelect`, demo dataset field `volumen` → `volume`, and `performanceTimmer` → `performanceTimer`. None of these are part of the public API.
