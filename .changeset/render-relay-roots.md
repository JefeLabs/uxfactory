---
"@uxfactory/bridge": patch
---

The canvas render relay is root-scoped: GET /next and POST/GET /rendered
accept an optional ?root= that reads/writes that served root's own
.uxfactory queue and reports (where the worker's landing step already drops
render jobs). Requests without ?root= keep the legacy launch-store wire
byte-identically.
