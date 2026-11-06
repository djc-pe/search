/* Índices de búsqueda por nodos.
 *
 * Cada web publica una raíz (search-index/root.json) con el centroide de cada
 * uno de sus nodos, y un archivo por nodo (search-index/nodes/<n>.json) con
 * sus páginas y los vectores de sus fragmentos. Para una consulta se comparan
 * los centroides de todas las webs a la vez, se cargan solo los nodos más
 * cercanos y se ordenan sus páginas.
 *
 * Sin DOM: lo usan la página (search.js) y las pruebas en Node. Mismo cálculo
 * que tools/search/search.py: cada fragmento puntúa con el producto escalar
 * (vectores de longitud 1) y cada página, con su mejor fragmento.
 */

export const FORMAT = 2;

// fetchJson(url, version) -> objeto. base: URL del search-index/ de la web.
export async function loadRoot(fetchJson, base) {
  const root = await fetchJson(new URL('root.json', base));
  if (root.format !== FORMAT) {
    throw new Error(`el índice de ${root.site || '?'} tiene el formato ${root.format}; esta página entiende el ${FORMAT}`);
  }
  const dims = root.model.dims;
  const nodes = root.nodes.map((node) => {
    const centroid = decodeInt8(node.centroid.data, dims);
    return { ...node, url: new URL(node.file, base), centroid, centroidScale: node.centroid.scale, root };
  });
  return { ...root, nodes };
}

// Las raíces del contexto (?c=tutorial o ?c=price,tienda: nombres de web, ver
// sources.json). Sin contexto, o si ninguno existe, son todas.
export function inContext(roots, context) {
  const names = new Set(String(context || '').toLowerCase().split(',').map((n) => n.trim()).filter(Boolean));
  const chosen = roots.filter((root) => names.has(root.site));
  return chosen.length ? chosen : roots;
}

// Los nodos más cercanos a la consulta, entre todas las raíces: [{ node, score }].
export function selectNodes(roots, query, probe = 3) {
  const scored = roots.flatMap((root) => root.nodes.map((node) => ({
    node,
    score: dot(node.centroid, query) * node.centroidScale,
  })));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, probe);
}

// Un nodo listo para rank(): { docs, owners, scales, vectors, dims }.
export async function loadNode(fetchJson, node) {
  const raw = await fetchJson(node.url, node.version);
  const dims = node.root.model.dims;
  const vectors = decodeInt8(raw.data, dims * raw.doc.length);
  if (vectors.length !== raw.doc.length * dims) {
    throw new Error(`${node.file} no cuadra: ${vectors.length} valores para ${raw.doc.length} fragmentos`);
  }
  return { docs: raw.docs, owners: raw.doc, scales: Float32Array.from(raw.scale), vectors, dims };
}

// Las páginas mejor puntuadas de un nodo: [{ doc, score }], de mayor a menor.
export function rank(index, query, top = 10) {
  const { owners, scales, vectors, dims, docs } = index;
  const best = new Float32Array(docs.length).fill(-2);
  for (let c = 0; c < owners.length; c++) {
    let s = 0;
    const base = c * dims;
    for (let d = 0; d < dims; d++) s += vectors[base + d] * query[d];
    const score = s * scales[c];
    if (score > best[owners[c]]) best[owners[c]] = score;
  }
  const order = Array.from(best.keys()).filter((i) => best[i] > -2);
  order.sort((a, b) => best[b] - best[a]);
  return order.slice(0, top).map((i) => ({ doc: docs[i], score: best[i] }));
}

// Lo mismo sobre varios nodos: junta los mejores de cada uno.
export function rankMany(indexes, query, top = 10) {
  return indexes
    .flatMap((index) => rank(index, query, top))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function decodeInt8(text) {
  const bytes = decodeBase64(text);
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
