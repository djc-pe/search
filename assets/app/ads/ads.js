/* Anuncios de la página de búsqueda.
 *
 * El HTML de cada anuncio está tal cual en su archivo (content1.js...). Aquí
 * solo se inserta entero, dentro de un bloque sin etiqueta. Se usa
 * createContextualFragment y no innerHTML porque así el navegador sí ejecuta
 * el <script> del anuncio.
 */
import content1 from './content1.js';
import content2 from './content2.js';

// Móvil: content2 (300x250). PC: content1 (adaptable). Mismo corte que la barra
// de navegación. Se decide al insertar: cada búsqueda recarga la página.
const MOBILE = '(max-width: 768px)';

const BLOCK = (content) => `<li class="search-result search-result--ad">
${content}
</li>`;

// Inserta el anuncio después del elemento `after` (un <li> de la lista).
export function insertAd(after, content = matchMedia(MOBILE).matches ? content2 : content1) {
  const range = document.createRange();
  range.selectNodeContents(after.parentNode);
  after.after(range.createContextualFragment(BLOCK(content)));
}
