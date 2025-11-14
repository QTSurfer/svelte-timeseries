# qtsurfer-svelte-timeseries

![NPM Version](https://img.shields.io/npm/v/%40qtsurfer%2Fsvelte-timeseries?registry_uri=https%3A%2F%2Fregistry.npmjs.com&style=flat&logo=npm&label=QTSurfer%2Fsvelte-timeseries)
[![license](https://img.shields.io/npm/l/%40qtsurfer%2Fsvelte-timeseries?registry_uri=https%3A%2F%2Fregistry.npmjs.com&style=flat)](LICENSE.md)

> Componente Svelte profesional para explorar **series temporales masivas** directamente en el navegador usando DuckDB-WASM, Apache Arrow y SVECharts.

## Tabla de contenidos

1. [Visión general](#visión-general)
2. [Arquitectura base](#arquitectura-base)
3. [Características clave](#características-clave)
4. [Instalación](#instalación)
5. [Primeros pasos](#primeros-pasos)
6. [API del componente](#api-del-componente)
7. [TimeSeriesFacade en la práctica](#timeseriesfacade-en-la-práctica)
8. [APIs avanzadas](#apis-avanzadas)
9. [Escenarios de referencia](#escenarios-de-referencia)
10. [Desarrollo y pruebas](#desarrollo-y-pruebas)
11. [Soporte y contribuciones](#soporte-y-contribuciones)

## Visión general

`@qtsurfer/svelte-timeseries` empaqueta todo lo necesario para construir dashboards financieros, industriales o científicos con millones de puntos de datos. El componente trae:

- Lectura de archivos Parquet/Arrow mediante DuckDB-WASM directamente en el navegador.
- Transformaciones columnar → ECharts listas para usar gracias a Apache Arrow.
- Marcadores/eventos sincronizados con cualquier dimensión.
- Personalización de paneles laterales con snippets de Svelte.

## Arquitectura base

| Capa | Rol |
| --- | --- |
| DuckDB-WASM | Ejecuta SQL sobre Parquet sin backend adicional y mantiene la data en memoria columnar. |
| `TimeSeriesFacade` | Coordina DuckDB + `TimeSeriesChartBuilder`, maneja la carga incremental de columnas y expone el estado de la UI. |
| `@qtsurfer/sveltecharts` | Fachada que arma y actualiza instancias de ECharts de manera declarativa. |
| SvelteKit | Aloja el componente, snippets y páginas demo. |

## Características clave

- **Escala en el navegador**: probado con datasets de más de 10 millones de valores sin recargar la página.
- **Carga diferida**: columnas adicionales se descargan sólo cuando el usuario las activa.
- **Marcadores nativos**: señales de trading, alertas o anotaciones se renderizan con íconos y colores personalizados.
- **Paneles reemplazables**: provee snippets para columnas y métricas, pero puedes inyectar tu propia UI.
- **Modo depuración**: logs de la inicialización DuckDB/ECharts para diagnósticos entre navegadores.

## Instalación

```bash
pnpm add @qtsurfer/svelte-timeseries
# o
npm install @qtsurfer/svelte-timeseries
yarn add @qtsurfer/svelte-timeseries
```

Requisitos:

- Proyecto SvelteKit con TypeScript.
- Posibilidad de servir archivos Parquet/Arrow (local o CDN).

## Primeros pasos

```svelte
<script lang="ts">
	import { SvelteTimeSeries } from '@qtsurfer/svelte-timeseries';

	const tables = {
		temps: {
			url: '/temps_gzip.parquet',
			mainColumn: 'temp'
		}
	};

	const markers = {
		table: 'temps',
		targetColumn: '_signal',
		targetDimension: 'temp'
	};
</script>

<SvelteTimeSeries table={tables} {markers} debug={false} />
```

## API del componente

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `table` | `Record<string, { url: string; mainColumn: string; columnsSelect?: string[] }>` | Define las tablas Parquet y su columna principal; la clave del objeto se usa como nombre de vista en DuckDB. |
| `markers?` | `MarkersTableOptions` | Tabla y columna JSON para generar la vista `markers` con `shape`, `color`, `position` y `text`. |
| `debug?` | `boolean` (default `true`) | Habilita logs detallados de carga DuckDB y builder. |
| `columnsSnippet?` | `Snippet<[ColumnsProps]>` | Sobrescribe el panel de columnas. |
| `performanceSnippet?` | `Snippet<[PerformanceProps]>` | Sobrescribe el panel de métricas/rendimiento. |

## TimeSeriesFacade en la práctica

`TimeSeriesFacade` (ver `src/lib/TimeSeriesFacade.ts`) concentra la lógica del componente:

1. **Inicialización** (`initialize`) – descarga la columna principal, arma el dataset y establece íconos/leyendas.
2. **Carga incremental** (`addDimension` / `toggleColumn`) – consulta nuevas columnas sólo cuando el usuario lo solicita.
3. **Marcadores** (`loadMarkers`) – lee la vista `markers` y añade anotaciones en ECharts.
4. **Estado observable** (`getColumns`, `describe`, `getLegendStatus`) – entrega datos listos para paneles personalizados.

Puedes importar la clase para construir dashboards a medida reutilizando toda la canalización DuckDB → Arrow → ECharts.

## APIs avanzadas

### 1. DuckDB

Usa la misma instancia que el componente para ejecutar SQL específico antes/después del render.

```ts
import { DuckDB } from '@qtsurfer/svelte-timeseries';

const duck = await DuckDB.create(
	{
		signal: {
			url: '/signals.parquet',
			mainColumn: 'price'
		}
	},
	undefined,
	true
);

const rows = await duck.getRangeData('signal', '2024-01-01', '2024-01-31', 1000);
await duck.closeConnection();
```

Implementaciones destacadas (`src/lib/duckdb/DuckDB.ts`):

- `DuckDB.create` valida `window + Worker`, registra las vistas y mide el tiempo de carga.
- `getSingleDimension` normaliza timestamps a milisegundos y devuelve arreglos Arrow listos para `TimeSeriesChartBuilder`.
- `buildTablesAndSchemas` detecta tipos (castea porcentajes a `DOUBLE`, ignora columnas auxiliares, genera vista `markers`).
- `transformTableToMatrix` convierte resultados Arrow en matrices `[rows, columns]` amigables para cualquier UI.

### 2. TimeSeriesChartBuilder

Construye layouts ECharts totalmente personalizados reutilizando la lógica de leyendas, marcadores y métricas.

```ts
import { TimeSeriesChartBuilder } from '@qtsurfer/svelte-timeseries';

const builder = new TimeSeriesChartBuilder(echartsInstance, {
	externalManagerLegend: true
});

builder.setLegendIcon('circle');
builder.setDataset(
	{ _ts: timestamps, price: prices, ema20: ema20Series },
	['_ts', 'price', 'ema20']
);

builder.addMarkerPoint(
	{ dimName: 'price', timestamp: timestamps[100], name: 'Breakout' },
	{ icon: 'pin', color: '#FF7F50' }
);

builder.build();
```

## Escenarios de referencia

Tomados del demo en `packages/svelte-timeseries/src/routes/+page.svelte`:

1. **Datos mínimos** (`temps_gzip_mini.parquet`): perfecta para pruebas rápidas o dashboards embebidos.
2. **1 millón de filas** (`temps_gzip.parquet`): prueba de estrés para navegadores modernos sin degradar UX.
3. **Dataset parcial (1.807.956 valores)**: uso de `columnsSelect` para reducir peso inicial y habilitar toggles progresivos.
4. **Dataset completo (10.245.084 valores)**: muestra la capacidad de manejar estrategias cuantitativas densas.
5. **Marcadores sincronizados**: aplica en los dos últimos escenarios para superponer señales `_m` sobre `price`.

## Desarrollo y pruebas

```bash
pnpm install
pnpm dev --filter svelte-timeseries
```

- Los archivos de ejemplo (`*.parquet`) viven en `packages/svelte-timeseries/static`. Ajusta `baseUrl` en el demo cuando publiques en un CDN.
- Métodos útiles para depuración en `DuckDB.ts`: `closeConnection`, `getRangeData`, `getMarkers`.
- Usa `debug={true}` en el componente para medir tiempos reales de carga en cada navegador.

## Soporte y contribuciones

- ¿Necesitas cubrir otro caso (datos en streaming, agregaciones intradía)? Abre un issue describiendo el escenario.
- Los PRs son bienvenidos: incluye pasos de reproducción, dataset de ejemplo y capturas animadas si afectan la UI.
- Si tu empresa utiliza el componente en producción, comparte el caso para incluirlo en la documentación.
