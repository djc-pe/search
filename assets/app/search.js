/* Página de search.djc.pe: lee ?q=, calcula su vector en el navegador y
 * muestra las páginas más parecidas de data/.
 *
 * El modelo (~23 MB, más el runtime de ONNX) solo se descarga si hay una
 * consulta; después lo guarda la caché del navegador. Las rutas son relativas a la página: funciona igual en
 * https://search.djc.pe/ y en local (http://localhost:8000/web/search/).
 */
import { createEmbedder } from './embed.js';
import { loadIndex, rank } from './index.js';
import { insertAd } from './ads/ads.js';

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
    const [index, embed] = await Promise.all([indexReady, loadEmbedder()]);
    const [vector] = await embed([query]);
    const results = rank(index, vector, TOP);
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

// Etiqueta de cada bloque según su dominio. Lo que no sea de DJC es 'Internet'.
// (Los anuncios llevan 'Ads': ver ads/ads.js.)
const LABELS = {
  'www.djc.pe': 'DJC',
  'tutorial.djc.pe': 'DJC Tutorial',
  'story.djc.pe': 'DJC Story',
  'search.djc.pe': 'DJC Search',
};

function labelOf(item) {
  try {
    return LABELS[new URL(item.url).hostname] || 'Internet';
  } catch {
    return 'Internet';
  }
}

// item: { url, title, description }
function block(item) {
  const li = document.createElement('li');
  li.className = 'search-result';

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

// Anuncio después del resultado AD_AFTER, si hay más resultados (ver ads/).
const AD_AFTER = 3;

function render(results) {
  const items = results.map(({ doc }) => block(doc));
  list.replaceChildren(...items);
  if (items.length > AD_AFTER) insertAd(items[AD_AFTER - 1]);
}

function queryFromUrl() {
  return new URLSearchParams(location.search).get('q') || '';
}

// Cada búsqueda es una página nueva (el formulario navega a ?q=...): así cada
// una tiene sus anuncios. El modelo no se vuelve a descargar, sale de la caché.
form.addEventListener('submit', (e) => {
  input.value = input.value.trim();
  if (!input.value) e.preventDefault();
});

input.value = queryFromUrl();
if (input.value) run(input.value);
indexReady.catch((err) => say(`No se pudo cargar el índice: ${err.message}`, true));
