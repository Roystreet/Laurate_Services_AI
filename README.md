# Laurate Convertidor Markdown

Servicio REST en Node.js que recibe un documento (**PDF**, **Word .docx** o **imagen/fotografía**) y devuelve todo su texto convertido a formato **Markdown**. El análisis se realiza con IA usando modelos **GPT de OpenAI**.

## Características

- **Estrategia híbrida** (rápida y económica):

  | Tipo de documento | Flujo de procesamiento | Estrategia (`meta.strategy`) |
  |---|---|---|
  | PDF con texto | Extracción local (`pdf-parse`) → GPT estructura el Markdown | `local-pdf-parse+gpt` |
  | PDF escaneado | El PDF se envía directo al modelo de visión de OpenAI | `openai-pdf-vision` |
  | Word .docx | Extracción local (`mammoth`) → GPT estructura el Markdown | `local-mammoth+gpt` |
  | Imagen (JPEG/PNG/WEBP) | OCR y estructuración con GPT Vision | `openai-image-vision` |

- **Seguridad en producción**: API key (`x-api-key`), rate limiting, límite de tamaño de archivo, whitelist de tipos con verificación de firma binaria (magic bytes) y headers de seguridad (`helmet`).
- **Documentación interactiva** de los endpoints con Swagger UI en `/docs`.

## Requisitos

- Node.js >= 18 (probado con Node 20)
- Una API key de OpenAI ([platform.openai.com](https://platform.openai.com/api-keys))

## Instalación

```bash
npm install
copy .env.example .env   # en Linux/macOS: cp .env.example .env
```

Edita `.env` y coloca tu `OPENAI_API_KEY`.

## Ejecución

```bash
# Desarrollo (recarga automática)
npm run dev

# Producción
set NODE_ENV=production   # PowerShell: $env:NODE_ENV = "production"
npm start
```

En **producción** (`NODE_ENV=production`) la variable `API_KEY` es **obligatoria**: el servidor no arranca sin ella y todas las llamadas a `/api/v1/*` deben incluir el header `x-api-key`. Si defines `API_KEY` en desarrollo, la validación también se activa (útil para probar la autenticación).

## Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | API key de OpenAI |
| `API_KEY` | Solo en producción | — | Clave que deben enviar los clientes en `x-api-key` |
| `PORT` | No | `3000` | Puerto del servidor |
| `NODE_ENV` | No | `development` | `production` activa la seguridad |
| `OPENAI_TEXT_MODEL` | No | `gpt-4o-mini` | Modelo para estructurar texto a Markdown |
| `OPENAI_VISION_MODEL` | No | `gpt-4o-mini` | Modelo de visión (imágenes y PDFs escaneados) |
| `MAX_FILE_SIZE_MB` | No | `10` | Tamaño máximo del archivo |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Ventana del rate limit (15 min) |
| `RATE_LIMIT_MAX` | No | `30` | Solicitudes permitidas por ventana e IP |
| `SCANNED_PDF_MIN_CHARS` | No | `200` | Mínimo de caracteres extraídos para no considerar el PDF como escaneado |

## API

Documentación interactiva: **http://localhost:3000/docs** (spec JSON en `/docs.json`).

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/v1/convert` | `x-api-key` (producción) | Convierte un documento a Markdown |
| `GET` | `/health` | Ninguna | Estado del servicio |
| `GET` | `/docs` | Ninguna | Swagger UI |

### `POST /api/v1/convert`

Hay **dos formas** de enviar el documento:

1. **Subida directa** — `multipart/form-data` con el documento en el campo **`file`**.
2. **Por URL** — body **JSON** con la URL desde donde el servicio descargará el documento:

```json
{
  "url": "https://ejemplo.com/archivos/informe.pdf",
  "filename": "informe.pdf"
}
```

`filename` es opcional: ayuda a identificar el documento y detectar su tipo; si se omite, se deriva de la URL. El tipo real del documento descargado se detecta por su contenido (magic bytes) y aplica la misma whitelist y límite de tamaño que la subida directa.

**Respuesta 200:**

```json
{
  "filename": "informe.pdf",
  "mimeType": "application/pdf",
  "markdown": "# Informe anual\n\nContenido del documento...",
  "meta": {
    "model": "gpt-4o-mini",
    "strategy": "local-pdf-parse+gpt",
    "tokensUsed": 1234,
    "processingMs": 4321
  }
}
```

**Errores** (shape uniforme `{ "error": { "code", "message", "status" } }`):

| Status | Código | Causa |
|---|---|---|
| 400 | `MISSING_FILE` | No se envió ni el campo `file` ni una `url` en el body JSON |
| 400 | `UNSUPPORTED_FILE_TYPE` | Tipo no soportado o contenido que no coincide con el tipo declarado |
| 400 | `INVALID_URL` | La URL es inválida o usa un protocolo distinto de http/https |
| 401 | `INVALID_API_KEY` | Header `x-api-key` ausente o inválido |
| 413 | `FILE_TOO_LARGE` | El documento excede `MAX_FILE_SIZE_MB` |
| 422 | `EXTRACTION_FAILED` | Documento corrupto o sin contenido extraíble |
| 422 | `DOWNLOAD_FAILED` | No se pudo descargar el documento desde la URL (error HTTP, timeout o respuesta vacía) |
| 429 | `RATE_LIMIT_EXCEEDED` | Rate limit excedido |
| 502 | `UPSTREAM_AI_ERROR` | Fallo en la llamada a OpenAI |
| 500 | `INTERNAL_ERROR` | Error interno |

### Ejemplos con curl

> En PowerShell usa `curl.exe` (el alias `curl` es `Invoke-WebRequest`).

```bash
# Estado del servicio
curl.exe http://localhost:3000/health

# Convertir un PDF
curl.exe -X POST http://localhost:3000/api/v1/convert -F "file=@C:\ruta\informe.pdf"

# Convertir un Word
curl.exe -X POST http://localhost:3000/api/v1/convert -F "file=@C:\ruta\documento.docx"

# Convertir una fotografía
curl.exe -X POST http://localhost:3000/api/v1/convert -F "file=@C:\ruta\foto.jpg"

# Convertir un documento desde una URL (sin subirlo directamente)
curl.exe -X POST http://localhost:3000/api/v1/convert -H "Content-Type: application/json" -d "{\"url\": \"https://ejemplo.com/archivos/informe.pdf\", \"filename\": \"informe.pdf\"}"

# En producción (con API key)
curl.exe -X POST http://localhost:3000/api/v1/convert -H "x-api-key: tu-clave-secreta" -F "file=@C:\ruta\informe.pdf"
```

## Estructura del proyecto

```
src/
├── index.js                  # Bootstrap: dotenv, validación de config, listen
├── app.js                    # Ensamblaje de Express: seguridad, rutas, docs, errores
├── config/index.js           # Configuración por variables de entorno
├── docs/swagger.js           # Especificación OpenAPI 3 (swagger-jsdoc)
├── routes/                   # Rutas con anotaciones @openapi
├── controllers/              # Orquestación de la conversión
├── services/
│   ├── openai.client.js      # Cliente OpenAI (singleton)
│   ├── download.service.js   # Descarga de documentos desde URL (con límites y timeout)
│   ├── markdown.service.js   # Texto crudo → Markdown vía GPT (con chunking)
│   └── extractors/           # Extractores por tipo: pdf, docx, imagen
├── middleware/               # API key, upload/validación (directa y por URL), errores
└── utils/                    # ApiError y detección de tipos de archivo (magic bytes)
```

## Limitaciones conocidas

- **PDF escaneado**: se envía a OpenAI, que admite hasta ~100 páginas / 32 MB por solicitud.
- **Word**: solo `.docx` (no el formato antiguo `.doc`).
- Documentos muy largos consumen más tokens de OpenAI (costo) y se procesan por partes.
- El rate limit es por IP y en memoria (si se despliega en múltiples instancias, considerar un store compartido como Redis).
- **Conversión por URL**: el servicio descarga desde cualquier URL http/https accesible. Si se despliega en una red interna, considera restringir los dominios permitidos para mitigar SSRF (solicitudes hacia servicios internos).
