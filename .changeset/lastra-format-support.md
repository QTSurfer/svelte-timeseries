---
"@qtsurfer/svelte-timeseries": minor
---

Add support for the Lastra binary format. Tables can now be configured with a `lastra` source (Blob, File, ArrayBuffer, Uint8Array, or URL ending in `.lastra`). The DuckDB engine is upgraded to `@duckdb/duckdb-wasm@1.33.1-dev53.0` (DuckDB v1.5.2) which publishes the community `lastra` extension for WASM.
