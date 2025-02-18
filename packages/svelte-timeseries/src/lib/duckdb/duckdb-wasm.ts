import * as duckdb from '@duckdb/duckdb-wasm';
import { AsyncDuckDB, ConsoleLogger } from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdb_wasm,
		mainWorker: mvp_worker
	},
	eh: {
		mainModule: duckdb_wasm_eh,
		mainWorker: eh_worker
	}
};
// See https://github.com/duckdb/duckdb-wasm/tree/main/packages/duckdb-wasm
// Select a bundle based on browser checks
const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
// Instantiate the asynchronus version of DuckDB-wasm
const worker = new Worker(bundle.mainWorker!);
const logger = new ConsoleLogger();
const db = new AsyncDuckDB(logger, worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
export { db };
