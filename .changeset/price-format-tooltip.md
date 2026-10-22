---
"@qtsurfer/sveltecharts": minor
"@qtsurfer/svelte-timeseries": minor
---

Clean price axis at 11 decimals, and `priceDecimals` reaches the tooltip.

- **Axis at 11 decimals.** lightweight-charts builds its price formatter from `10 ** precision` and `minMove * 10 ** precision`, and needs the second to be exactly 1. With the `minMove` of `10 ** -11` it is not (`1e-11 * 1e11` is `0.9999999999999999`), and the axis wrote `0.99999999995` for `3.96e-8`, even `48000.99999.99999` for `48000.5`. The charts now pass the nearest `minMove` that gives exactly 1. It applies to every price format of the Lightweight Charts engine: the price line, the candles and the injected series, with a fixed `priceDecimals` or with the decimals the data needs.
- **`priceDecimals` in the tooltip.** With `priceDecimals` set, the price rows of the tooltip use the same format as the axis, so `46440.04794271` shows as `46440.05` with `priceDecimals: 2`. Without it the tooltip is unchanged: the shortest decimals the value needs.
- At 16 decimals the chart still writes a price above 1 with a wrong tail (`48000.4999999999967232` for `48000.5`), because the formatter multiplies the price by `10 ** 16`. Stay at 15 decimals or fewer for those prices.
