---
"@qtsurfer/svelte-timeseries": minor
"@qtsurfer/sveltecharts": minor
---

More control over Lightweight Charts, a pure-helpers entry point and a time zone fix for Parquet files.

- **Marker size.** `InjectedMarker.size` multiplies the glyph (`2` draws it twice as large, default `1`) on Lightweight Charts and ECharts. Markers of different sizes are not merged into one glyph.
- **Marker hover tolerance.** The hover text shows the marker nearest to the cursor when it is within a few pixels (`markerHoverTolerance`, default 4, `0` for the bar under the cursor only). With many bars per pixel the text used to show only on the exact bar.
- **Last-value label and price line.** `InjectedSeries.lastValueVisible` and `priceLineVisible` (Lightweight Charts, default `true`) take a series off the price axis (its label, its name tag and its line), so a dozen series do not cover it. The tooltip row keeps the name.
- **Empty panes.** `setCollapseEmptyPanes(true)` on the builders, or `collapseEmptyPanes` on `TimeSeriesChart`, shrinks a pane whose series are all hidden.
- **Price axis decimals.** `priceDecimals` (0 to 16) fixes the decimals of the price line and the candles on Lightweight Charts, so one value with many decimals no longer widens the whole axis.
- **Chart options and legend.** `TimeSeriesChart` takes `lightweightOptions`, merged into the defaults one object level at a time, for the background, the text color and the rest. The TradingView attribution logo stays on. The adapter gains `getLegendItems` and `onLegendChange` (capability `legend`), and `TimeSeriesChart` an `onLegendChange` prop, for a legend of your own on Lightweight Charts.
- **Pure helpers.** `@qtsurfer/sveltecharts/core` exports `aggregateCandles`, `resolvePriceData`, `normalizeInjectedMarkers`, `groupMarkers` and the precision helpers. It imports no Svelte file and no chart library, so it loads in plain Node, in a test runner without the Svelte plugin and in a worker.
- **ECharts axis labels in UTC.** The time axis showed the viewer's local time while the `useUTC` option and Lightweight Charts used UTC. It is UTC now.
- **Time zone of Parquet files.** A time column of type `TIMESTAMP WITH TIME ZONE` is read as the UTC time. Before, a window built from epoch milliseconds shifted by the viewer's time zone, and a zoom on such a file could come back empty (for example in a Europe/Madrid browser).
