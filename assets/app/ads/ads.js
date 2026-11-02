/* Anuncios de la página de búsqueda.
 *
 * El HTML de cada anuncio está tal cual en su archivo (content1.js...). Aquí
 * solo se inserta entero, dentro de un bloque con la etiqueta "Ads". Se usa
 * createContextualFragment y no innerHTML porque así el navegador sí ejecuta
 * el <script> del anuncio.
 */
import content1 from './content1.js';

const BLOCK = (content) => `<li class="search-result search-result--ad">
<span class="search-result__label">Ads</span>
${content}
</li>`;

// Inserta el anuncio después del elemento `after` (un <li> de la lista).
export function insertAd(after, content = content1) {
  const range = document.createRange();
  range.selectNodeContents(after.parentNode);
  after.after(range.createContextualFragment(BLOCK(content)));
}
