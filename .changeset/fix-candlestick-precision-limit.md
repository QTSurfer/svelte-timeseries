---
'@qtsurfer/sveltecharts': patch
---

Cap chart price precision at lightweight-charts' own 16-digit limit, so a series with extremely small values (near-zero prices) no longer crashes on render.
