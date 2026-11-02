/* Índice de búsqueda: carga data/ y ordena las páginas por similitud.
 *
 * Sin DOM: lo usan la página (search.js) y las pruebas en Node. Mismo cálculo
 * que tools/search/search.py: cada fragmento puntúa con el producto escalar
 * (vectores de longitud 1) y cada página, con su mejor fragmento.
 */

export const FORMAT = 1;

// fetchJson(nombre, version) -> objeto. En el navegador, fetch relativo a data/.
export async function loadIndex(fetchJson) {
  const manifest = await fetchJson('manifest.json');
  if (manifest.format !== FORMAT) {
    throw new Error(`data/ tiene el formato ${manifest.format}; esta página entiende el ${FORMAT}`);
  }
  const [docs, raw] = await Promise.all([
    fetchJson(manifest.files.docs, manifest.version),
    fetchJson(manifest.files.vectors, manifest.version),
  ]);
  const dims = manifest.model.dims;
  const bytes = decodeBase64(raw.data);
  const vectors = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (vectors.length !== raw.doc.length * dims) {
    throw new Error(`vectors.json no cuadra: ${vectors.length} valores para ${raw.doc.length} fragmentos`);
  }
  return { manifest, docs, owners: raw.doc, scales: Float32Array.from(raw.scale), vectors, dims };
}

// Las páginas mejor puntuadas: [{ doc, score }], de mayor a menor.
export function rank(index, query, top = 10) {
  const { owners, scales, vectors, dims, docs } = index;
  const best = new Float32Array(docs.length).fill(-2);
  for (let c = 0; c < owners.length; c++) {
    let dot = 0;
    const base = c * dims;
    for (let d = 0; d < dims; d++) dot += vectors[base + d] * query[d];
    const score = dot * scales[c];
    if (score > best[owners[c]]) best[owners[c]] = score;
  }
  const order = Array.from(best.keys()).filter((i) => best[i] > -2);
  order.sort((a, b) => best[b] - best[a]);
  return order.slice(0, top).map((i) => ({ doc: docs[i], score: best[i] }));
}

function decodeBase64(text) {
  if (typeof atob === 'function') {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(text, 'base64')); // Node
}
