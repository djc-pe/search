# DJC SEARCH

Búsqueda de search.djc.pe. Se hace en el navegador: la consulta se convierte en
un vector con un modelo de embeddings y se compara con los vectores de las
páginas, ya calculados. La consulta no se envía a ningún servidor.

- `index.html`: la página; lee `?q=`.
- `assets/app/`: `search.js` (la página), `index.js` (carga `data/` y ordena),
  `embed.js` (vector de un texto) y `search.css`.
- `assets/app/ads/`: `ads.js` inserta el anuncio después del tercer resultado,
  `ads.css` su bloque, y `content1.js` tiene el HTML del anuncio tal cual (se
  pega entero, no se edita).
- `data/`: el índice. Lo genera `tools/search/build.py` en el repo de origen; no
  se edita a mano.
- `models/all-MiniLM-L6-v2/`: el modelo (Apache 2.0, ver su `README.md`).

transformers.js se carga desde jsDelivr, en una versión fija (`LIB_URL` en
`assets/app/search.js`). El modelo solo se descarga si hay una consulta. Cada
búsqueda recarga la página (`?q=...`), así cada una muestra anuncios nuevos.
