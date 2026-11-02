/* Vector de un texto con all-MiniLM-L6-v2 (ONNX int8), igual que en Python.
 *
 * Mismo cálculo que tools/search/embed.py: tokenizar truncando a 256, modelo,
 * media de last_hidden_state sobre attention_mask y normalización L2.
 *
 * No importa transformers.js: lo recibe, para servir igual en el navegador
 * (desde un CDN o una copia local) y en Node (las pruebas de paridad).
 *
 *   import * as lib from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
 *   const embed = await createEmbedder(lib, { modelPath: '/models/' });
 *   const [vector] = await embed(['how to undo a git commit']);   // Float32Array(384)
 */

export const MODEL_ID = 'all-MiniLM-L6-v2';
export const MAX_TOKENS = 256;
export const DIMS = 384;

// progress: función opcional que recibe los avisos de descarga de transformers.js
// ({ status, file, loaded, total, progress }).
export async function createEmbedder(lib, { modelPath, device = 'wasm', progress } = {}) {
  lib.env.allowRemoteModels = false;
  lib.env.allowLocalModels = true;
  if (modelPath) lib.env.localModelPath = modelPath;

  const options = progress ? { progress_callback: progress } : {};
  const tokenizer = await lib.AutoTokenizer.from_pretrained(MODEL_ID, options);
  const model = await lib.AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8', device, ...options });

  return async function embed(texts) {
    const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: MAX_TOKENS });
    const ids = inputs.input_ids;
    // token_type_ids en ceros, como en Python
    const feed = {
      input_ids: ids,
      attention_mask: inputs.attention_mask,
      token_type_ids: new lib.Tensor('int64', new BigInt64Array(ids.data.length), ids.dims),
    };
    const { last_hidden_state: hidden } = await model(feed);
    const [n, tokens, dims] = hidden.dims;
    const data = hidden.data;
    const mask = inputs.attention_mask.data;
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = new Float32Array(dims);
      let count = 0;
      for (let t = 0; t < tokens; t++) {
        if (Number(mask[i * tokens + t]) === 0) continue;
        count++;
        const base = (i * tokens + t) * dims;
        for (let d = 0; d < dims; d++) v[d] += data[base + d];
      }
      let norm = 0;
      for (let d = 0; d < dims; d++) {
        v[d] /= Math.max(count, 1e-9);
        norm += v[d] * v[d];
      }
      norm = Math.max(Math.sqrt(norm), 1e-12);
      for (let d = 0; d < dims; d++) v[d] /= norm;
      out.push(v);
    }
    return out;
  };
}

/* Similitud de coseno; con vectores de longitud 1 es el producto escalar. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}
