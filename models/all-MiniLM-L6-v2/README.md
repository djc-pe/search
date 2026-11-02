# all-MiniLM-L6-v2 (ONNX, cuantizado int8)

Modelo de embeddings que usa la búsqueda de search.djc.pe: convierte un texto en
un vector de 384 dimensiones. Lo usan el navegador (transformers.js) y el
preproceso en Python (onnxruntime), con estos mismos archivos.

## Origen
- Modelo original: [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), licencia Apache 2.0.
- Conversión a ONNX: [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), licencia Apache 2.0,
  revisión `751bff37182d3f1213fa05d7196b954e230abad9`.

Los archivos están copiados sin cambios de esa revisión. La licencia está en
`LICENSE`.

| Archivo | SHA-256 |
| --- | --- |
| `onnx/model_quantized.onnx` | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
| `tokenizer.json` | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |

## Cómo se calcula el vector
Igual en Python y en JS:
1. Tokenizar con `tokenizer.json`, truncando a 256 tokens.
2. Pasar `input_ids`, `attention_mask` y `token_type_ids` (ceros) al modelo.
3. Media de `last_hidden_state` sobre los tokens con `attention_mask` = 1.
4. Normalizar a longitud 1 (L2): la similitud es el producto escalar.
