/* Página de search.djc.pe: lee ?q=, calcula su vector en el navegador y
 * muestra las páginas más parecidas de los índices de cada web.
 *
 * sources.json dice qué raíces cargar (el search-index/root.json de cada web),
 * qué modelo deben usar y cuántos nodos abrir por consulta (probe). Las raíces
 * se cargan a la vez que el modelo; con el vector de la consulta se eligen los
 * nodos más cercanos de todas las webs y solo esos se descargan. Si una raíz o
 * un nodo falla, o es de otro modelo, se busca en los demás.
 *
 * El modelo (~23 MB, más el runtime de ONNX) solo se descarga si hay una
 * consulta; después lo guarda la caché del navegador. Las rutas son relativas a la página: funciona igual en
 * https://search.djc.pe/ y en local (http://localhost:8000/web/search/).
 */
import { createEmbedder } from './embed.js';
import { loadRoot, selectNodes, loadNode, rankMany, inContext } from './index.js';
import { insertAd } from './ads/ads.js';

// transformers.js, versión fija (la misma de las pruebas de paridad).
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
const TOP = 10;

// Versión de la app (ver changelog/search.md en el repo de origen).
export const APP_VERSION = '0.4.1';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const context = document.getElementById('search-context');
const scope = document.getElementById('search-scope');
const status = document.getElementById('search-status');
const list = document.getElementById('search-results');

const meta = document.getElementById('search-meta');

const SOURCES = new URL('../../sources.json', import.meta.url);
const MODELS = new URL('../../models/', import.meta.url);
// En local (python -m http.server desde la raíz del repo) los índices se leen
// de las carpetas de al lado (web/<web>/search-index/), no de cada dominio.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

async function getJson(url, version) {
  url = new URL(url);
  if (version) url.searchParams.set('v', version);
  // sin versión (sources y raíces) se revalida siempre: dicen qué pedir del resto
  const res = await fetch(url, version ? {} : { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url.host}${url.pathname}: ${res.status}`);
  return res.json();
}

let probe = 3;
const kinds = new Map(); // web -> { kind, image } de su raíz
const DEFAULT_IMAGE = new URL('./default.svg', import.meta.url).href;

const rootsReady = (async () => {
  const sources = await getJson(SOURCES);
  probe = sources.probe || probe;
  const loaded = await Promise.allSettled(sources.sources.map(async (source) => {
    const base = new URL(LOCAL ? source.dev : source.url, SOURCES);
    const root = await loadRoot(getJson, base);
    if (root.model.sha256 !== sources.model.sha256) {
      throw new Error(`${source.site}: su índice usa otro modelo`);
    }
    return root;
  }));
  for (const r of loaded) if (r.status === 'rejected') console.warn('[search]', r.reason);
  const roots = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!roots.length) throw new Error('no hay ningún índice disponible');
  for (const r of roots) kinds.set(r.site, { kind: r.kind || 'page', image: r.image || '' });
  showMeta(roots);
  fillContexts(roots);
  return roots;
})();

// Nodos ya descargados en esta página (por url y versión).
const nodeCache = new Map();
function getNode(node) {
  const key = `${node.url}?v=${node.version}`;
  if (!nodeCache.has(key)) {
    const p = loadNode(getJson, node);
    p.catch(() => nodeCache.delete(key)); // permitir reintentar
    nodeCache.set(key, p);
  }
  return nodeCache.get(key);
}

// Los nodos más cercanos a la consulta, ya cargados. Si alguno falla, sigue con los demás.
async function nodesFor(roots, vector) {
  const chosen = selectNodes(roots, vector, probe);
  list.dataset.nodes = chosen.map(({ node }) => `${node.root.site}/${node.file}`).join(' ');
  const loaded = await Promise.allSettled(chosen.map(({ node }) => getNode(node)));
  for (const r of loaded) if (r.status === 'rejected') console.warn('[search]', r.reason);
  const nodes = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!nodes.length) throw new Error('no se pudo cargar ningún nodo del índice');
  return nodes;
}

// Pie: "DJC Search v0.1.0" y, debajo, "Índices: DJC Tutorial (48 páginas,
// actualizado el 3 nov. 2026), DJC (7 páginas, ...) y DJC Story (4 páginas)."
function showMeta(roots) {
  const parts = [...roots].sort((a, b) => b.docs - a.docs).map((m) => {
    const name = LABELS[new URL(m.host).hostname] || m.site;
    let text = `${name} (${m.docs} página${m.docs === 1 ? '' : 's'}`;
    if (m.updated) {
      const [y, mo, d] = m.updated.split('-').map(Number);
      text += `, actualizado el ${new Date(y, mo - 1, d).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return text + ')';
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0];
  const version = document.createElement('span');
  version.textContent = `DJC Search v${APP_VERSION}`;
  const detail = document.createElement('span');
  detail.textContent = `Índices: ${list}.`;
  meta.replaceChildren(version, document.createElement('br'), detail);
}

let embedderReady = null;
function loadEmbedder() {
  if (!embedderReady) {
    embedderReady = import(LIB_URL).then((lib) =>
      createEmbedder(lib, {
        // Ruta sin dominio (/models/ o /web/search/models/), no la URL entera:
        // con una URL http(s), transformers.js 4.x no busca el modelo en local
        // y, con las descargas remotas desactivadas, da por perdido el tokenizer.
        modelPath: MODELS.pathname,
      }));
    embedderReady.catch(() => { embedderReady = null; }); // permitir reintentar
  }
  return embedderReady;
}

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('search-status--error', isError);
}

// Mientras busca: bloques vacíos animados con la forma de los resultados.
// "Buscando" queda para lectores de pantalla (aria-live), no a la vista.
const PLACEHOLDERS = 3;

function showLoading() {
  const items = Array.from({ length: PLACEHOLDERS }, () => {
    const li = document.createElement('li');
    li.className = 'search-result search-result--loading';
    li.setAttribute('aria-hidden', 'true');
    for (const cls of ['title', 'url', 'text']) {
      const bar = document.createElement('div');
      bar.className = `search-loading__bar search-loading__bar--${cls}`;
      li.append(bar);
    }
    return li;
  });
  list.replaceChildren(...items);
  list.setAttribute('aria-busy', 'true');
  status.classList.add('search-status--sr');
  say('Buscando');
}

function hideLoading() {
  list.removeAttribute('aria-busy');
  status.classList.remove('search-status--sr');
}

async function run(query) {
  query = query.trim();
  document.title = query ? `${query} - DJC Search` : 'DJC Search';
  if (!query) return;
  showLoading();
  try {
    const [roots, embed] = await Promise.all([rootsReady, loadEmbedder()]);
    const [vector] = await embed([query]);
    const results = rankMany(await nodesFor(inContext(roots, contextFromUrl()), vector), vector, TOP);
    hideLoading();
    render(results);
    say(results.length ? '' : 'Sin resultados');
  } catch (err) {
    hideLoading();
    list.replaceChildren();
    say(`No se pudo buscar: ${err.message}`, true);
    console.error('[search]', err);
  }
}

// Nombre de cada web, para el pie de la página.
const LABELS = {
  'www.djc.pe': 'DJC',
  'tutorial.djc.pe': 'DJC Tutorial',
  'story.djc.pe': 'DJC Story',
  'search.djc.pe': 'DJC Search',
};

// Sin imagen: un cuadro con las iniciales de las dos primeras palabras del título
// (SVG en una data URL; colores de la marca). Sin letras en el título, no hay cuadro.
function initialsTile(item, web) {
  const words = (item.title || '').match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) || [];
  const text = words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  if (!text) return '';
  const [bg, fg] = web.kind === 'product' ? ['#ffffff', '#141414'] : ['#1d1d1d', '#e5f774'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>`
    + `<text x="50" y="50" fill="${fg}" font-family="system-ui,sans-serif" font-size="40" font-weight="700" text-anchor="middle" dominant-baseline="central">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// La imagen del resultado: la de la página, si no la de su web y, si no, sus iniciales.
// Si una no carga, pasa a la siguiente. Tamaño fijo: la lista no salta al cargarla.
function thumb(item, web) {
  const sources = [item.image, web.image, initialsTile(item, web) || DEFAULT_IMAGE].filter(Boolean);
  const img = document.createElement('img');
  img.className = 'search-result__image';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = web.kind === 'product' ? 176 : 144;
  img.height = web.kind === 'product' ? 176 : 144;
  let at = 0;
  img.src = sources[0];
  img.addEventListener('error', () => { if (++at < sources.length) img.src = sources[at]; });
  return img;
}

// item: { url, title, description, site, image }
function block(item) {
  const li = document.createElement('li');
  li.className = 'search-result';

  const link = document.createElement('a');
  link.className = 'search-result__title';
  link.href = item.url;
  link.textContent = item.title || item.url;

  const url = document.createElement('div');
  url.className = 'search-result__url';
  url.textContent = item.url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const web = kinds.get(item.site) || { kind: 'page', image: '' };
  li.classList.add(`search-result--${web.kind}`);
  const body = document.createElement('div');
  body.className = 'search-result__body';
  body.append(link, url);
  li.append(thumb(item, web), body);
  if (item.description && item.description !== item.title) {
    const p = document.createElement('p');
    p.className = 'search-result__description';
    p.textContent = item.description;
    body.append(p);
  }
  return li;
}

// Anuncio después del resultado AD_AFTER, si hay más resultados (ver ads/).
const AD_AFTER = 1;

function render(results) {
  const items = results.map(({ doc }) => block(doc));
  list.replaceChildren(...items);
  if (items.length > AD_AFTER) insertAd(items[AD_AFTER - 1]);
}

function contextFromUrl() {
  return new URLSearchParams(location.search).get('c') || '';
}

// Contexto: una fila de casillas bajo el cuadro, una por web (tutorial, home,
// price, tienda...). Sin ninguna marcada se busca en todo. Al buscar, lo marcado
// va en ?c= separado por comas.
const SCOPE_ORDER = ['tutorial', 'home', 'price', 'tienda'];

function fillContexts(roots) {
  const current = new Set(contextFromUrl().toLowerCase().split(',').filter(Boolean));
  const sites = roots.map((r) => r.site).sort((a, b) => {
    const [i, j] = [a, b].map((n) => (SCOPE_ORDER.includes(n) ? SCOPE_ORDER.indexOf(n) : SCOPE_ORDER.length));
    return i - j || a.localeCompare(b);
  });
  scope.replaceChildren(...sites.map((site) => {
    const label = document.createElement('label');
    label.className = 'search-scope__item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = site;
    box.checked = current.has(site);
    const text = document.createElement('span');
    text.textContent = site.charAt(0).toUpperCase() + site.slice(1);
    label.append(box, text);
    return label;
  }));
}

function queryFromUrl() {
  return new URLSearchParams(location.search).get('q') || '';
}

// Cada búsqueda es una página nueva (el formulario navega a ?q=...): así cada
// una tiene sus anuncios. El modelo no se vuelve a descargar, sale de la caché.
form.addEventListener('submit', (e) => {
  input.value = input.value.trim();
  if (!input.value) e.preventDefault();
  const chosen = [...scope.querySelectorAll('input:checked')].map((box) => box.value);
  context.value = chosen.join(',');
  context.disabled = !chosen.length; // sin contexto no va ?c=
});

meta.textContent = `DJC Search v${APP_VERSION}`;
input.value = queryFromUrl();
if (input.value) run(input.value);
rootsReady.catch((err) => say(`No se pudo cargar el índice: ${err.message}`, true));
