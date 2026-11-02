/* Página de search.djc.pe: lee ?q=, calcula su vector en el navegador y
 * muestra las páginas más parecidas de data/.
 *
 * El modelo (~23 MB, más el runtime de ONNX) solo se descarga si hay una
 * consulta o cuando la persona toca el buscador; después lo guarda la caché del
 * navegador. Las rutas son relativas a la página: funciona igual en
 * https://search.djc.pe/ y en local (http://localhost:8000/web/search/).
 */
import { createEmbedder } from './embed.js';
import { loadIndex, rank } from './index.js';

// transformers.js, versión fija (la misma de las pruebas de paridad).
const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
const TOP = 10;

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const status = document.getElementById('search-status');
const list = document.getElementById('search-results');

const DATA = new URL('../../data/', import.meta.url);
const MODELS = new URL('../../models/', import.meta.url);

const indexReady = loadIndex(async (name, version) => {
  const url = new URL(name, DATA);
  if (version) url.searchParams.set('v', version);
  // el manifest se revalida siempre: es el que dice qué versión pedir del resto
  const res = await fetch(url, version ? {} : { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url.pathname}: ${res.status}`);
  return res.json();
});

let embedderReady = null;
function loadEmbedder() {
  if (!embedderReady) {
    const files = new Map();
    embedderReady = import(LIB_URL).then((lib) =>
      createEmbedder(lib, {
        // Ruta sin dominio (/models/ o /web/search/models/), no la URL entera:
        // con una URL http(s), transformers.js 4.x no busca el modelo en local
        // y, con las descargas remotas desactivadas, da por perdido el tokenizer.
        modelPath: MODELS.pathname,
        progress: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files.set(p.file, p);
          let loaded = 0, total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          say(`Descargando el modelo: ${mb(loaded)} de ${mb(total)}`);
        },
      }));
    embedderReady.catch(() => { embedderReady = null; }); // permitir reintentar
  }
  return embedderReady;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('search-status--error', isError);
}

let current = 0; // descarta resultados de una búsqueda anterior que termine tarde

async function run(query) {
  const id = ++current;
  list.replaceChildren();
  query = query.trim();
  document.title = query ? `${query} - DJC Search` : 'DJC Search';
  if (!query) {
    say('');
    return;
  }
  say('Buscando');
  try {
    const [index, embed] = await Promise.all([indexReady, loadEmbedder()]);
    if (id !== current) return;
    const [vector] = await embed([query]);
    const results = rank(index, vector, TOP);
    if (id !== current) return;
    render(results);
    say(results.length ? '' : 'Sin resultados');
  } catch (err) {
    if (id !== current) return;
    say(`No se pudo buscar: ${err.message}`, true);
    console.error('[search]', err);
  }
}

// Etiqueta de cada bloque según su dominio. Lo que no sea de DJC es 'Internet';
// los anuncios llevan 'Ads' (kind: 'ad').
const LABELS = {
  'www.djc.pe': 'DJC',
  'tutorial.djc.pe': 'DJC Tutorial',
  'story.djc.pe': 'DJC Story',
  'search.djc.pe': 'DJC Search',
};

function labelOf(item) {
  if (item.kind === 'ad') return 'Ads';
  try {
    return LABELS[new URL(item.url).hostname] || 'Internet';
  } catch {
    return 'Internet';
  }
}

// item: { url, title, description, kind } (kind: 'page' por defecto, 'ad')
function block(item) {
  const li = document.createElement('li');
  li.className = 'search-result' + (item.kind === 'ad' ? ' search-result--ad' : '');

  const label = document.createElement('span');
  label.className = 'search-result__label';
  label.textContent = labelOf(item);

  const link = document.createElement('a');
  link.className = 'search-result__title';
  link.href = item.url;
  link.textContent = item.title || item.url;

  const url = document.createElement('div');
  url.className = 'search-result__url';
  url.textContent = item.url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  li.append(label, link, url);
  if (item.description && item.description !== item.title) {
    const p = document.createElement('p');
    p.className = 'search-result__description';
    p.textContent = item.description;
    li.append(p);
  }
  return li;
}

// Anuncio de AdSense después del resultado AD_AFTER (si hay más resultados).
const AD_AFTER = 3;
const AD_CLIENT = 'ca-pub-3775900744037301';
const AD_SLOT = '8296560475';
const AD_TIMEOUT = 5000;
// En local AdSense no sirve anuncios: se ve un recuadro de muestra.
const LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);

function adBlock() {
  const li = document.createElement('li');
  li.className = 'search-result search-result--ad';

  const label = document.createElement('span');
  label.className = 'search-result__label';
  label.textContent = labelOf({ kind: 'ad' });
  li.append(label);

  if (LOCAL) {
    const sample = document.createElement('div');
    sample.className = 'search-result__ad-sample';
    sample.textContent = 'Anuncio (muestra en local)';
    li.append(sample);
    return li;
  }

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.setAttribute('data-ad-client', AD_CLIENT);
  ins.setAttribute('data-ad-slot', AD_SLOT);
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  li.append(ins);
  return li;
}

// Pide el anuncio cuando el bloque ya está en la página. Si AdSense no lo
// procesa (bloqueado o sin cargar), el bloque se quita para no dejar un
// recuadro vacío; si no hay anuncio que mostrar, lo oculta el CSS (unfilled).
function fillAd(li) {
  const ins = li.querySelector('ins.adsbygoogle');
  if (!ins) return;
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (err) {
    console.warn('[search] anuncio:', err);
    li.remove();
    return;
  }
  setTimeout(() => {
    if (!ins.hasAttribute('data-adsbygoogle-status')) li.remove();
  }, AD_TIMEOUT);
}

function render(results) {
  const items = results.map(({ doc }) => block({ ...doc, kind: 'page' }));
  let ad = null;
  if (items.length > AD_AFTER) {
    ad = adBlock();
    items.splice(AD_AFTER, 0, ad);
  }
  list.replaceChildren(...items);
  if (ad) fillAd(ad);
}

function queryFromUrl() {
  return new URLSearchParams(location.search).get('q') || '';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = input.value.trim();
  const url = new URL(location.href);
  if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
  if (url.href !== location.href) history.pushState(null, '', url);
  run(query);
});

window.addEventListener('popstate', () => {
  input.value = queryFromUrl();
  run(input.value);
});

// adelantar la descarga del modelo en cuanto la persona va a buscar
input.addEventListener('focus', () => { loadEmbedder().catch(() => {}); }, { once: true });

input.value = queryFromUrl();
if (input.value) run(input.value);
indexReady.catch((err) => say(`No se pudo cargar el índice: ${err.message}`, true));
