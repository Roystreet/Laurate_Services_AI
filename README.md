# Laurate Convertidor Markdown

Servicio REST en Node.js que recibe un documento (**PDF**, **Word .docx** o **imagen/fotografía**) y devuelve todo su texto convertido a formato **Markdown**. El análisis se realiza con IA usando modelos **GPT de OpenAI**.

## Match de CV con propuesta laboral

`POST /api/v1/cv-match` compara el CV ya leído con una sola propuesta laboral. El tema de Copilot Studio está en `../Chat-Laurate/copilot/match-cv-propuesta.yaml` y utiliza el mismo botón y servicio de carga del widget. Primero se lee el CV con `/api/v1/convert`, se confirma la lectura y después se solicita el enlace de la propuesta. El análisis utiliza `OPENAI_API_KEY` y `OPENAI_TEXT_MODEL` del servidor; no necesita Flowise ni una clave del cliente.

Entrada JSON:

```json
{
  "cvMarkdown": "# CV\n\nDesarrollador de Node.js con cuatro años de experiencia en APIs REST y SQL...",
  "proposalUrl": "https://ejemplo.com/empleos/desarrollador"
}
```

Respuesta 200:

```json
{
  "verdict": "COMPATIBLE",
  "text": "**Compatibilidad: Compatible**\n\nEvaluación con evidencia, fortalezas, brechas y recomendaciones..."
}
```

- `verdict`: `COMPATIBLE`, `NO_COMPATIBLE` o `INFORMACION_INSUFICIENTE`. Sin porcentajes ni probabilidades de contratación. Una competencia no mencionada se considera no demostrada, no inexistente. Cuando falta información indispensable para decidir, se solicita esa información.
- `text`: Markdown en español listo para mostrar. La IA extrae requisitos, citas literales del CV y recomendaciones con un esquema estricto. El servidor verifica que cada cita exista en el CV y calcula el veredicto: una brecha demostrada en un requisito indispensable produce incompatibilidad; un indispensable sin evidencia produce información insuficiente; en los demás casos se requiere al menos una coincidencia demostrada. Las citas ausentes o inventadas no acreditan cumplimiento ni incumplimiento. El servidor compone la presentación y no almacena el análisis ni comparte una sesión de IA entre solicitudes.
- Propuestas admitidas: páginas HTML públicas, PDF, DOCX, JPEG, PNG, WEBP, Google Docs/Drive/Slides/Sheets y Dropbox compartidos. En HTML se prioriza `JobPosting` (JSON-LD); en su ausencia se lee el contenido principal y se eliminan navegación, scripts y formularios. Se admite compresión HTTP y se respeta el charset declarado.
- El lector de propuestas verifica cada destino y redirección y conecta a una IP pública previamente validada. Bloquea direcciones internas, loopback, enlaces con credenciales y respuestas DNS mixtas públicas/privadas. Las URL temporales propias se resuelven en memoria con su token, sin descarga de red.
- Se requiere el enlace de una sola vacante. Páginas con inicio de sesión, bloqueo o contenido no legible sin JavaScript requieren otro enlace o un documento público. No se ejecuta JavaScript del sitio ni se inicia sesión en portales.
- Límites: 80.000 caracteres por documento, sin truncamiento; JSON de hasta 512 KB en este endpoint; archivos según `MAX_FILE_SIZE_MB`. La descarga tiene hasta 30 segundos y cinco redirecciones. El análisis completo tiene 110 segundos; las llamadas de IA de este recorrido no realizan reintentos automáticos y reciben la señal de cancelación.

Los errores mantienen `{ "error": { "code", "message", "status" } }`: 400 para entradas/destinos inválidos, 404 para documentos temporales vencidos, 413 para límites, 422 para propuestas inaccesibles o ilegibles, 429 por frecuencia, 502 para fallos o respuestas inválidas de IA y 504 por tiempo agotado. El tema conserva el CV durante los reintentos de propuesta. Escribir `reintentar` vuelve a usar el enlace anterior; enviar otro enlace lo reemplaza. Al terminar se elimina el estado local del tema.

Para instalar: ejecutar `npm install`, mantener la configuración actual de OpenAI y publicar el backend en su origen HTTPS. En el agente, inicializar `Global.CONVERT_API_URL` con `/api/v1/convert` y `Global.CV_MATCH_API_URL` con `/api/v1/cv-match`. Swagger documenta el contrato en `/docs` y `/docs.json`. `ELEVENLABS_API_KEY` es una variable opcional de voz y no interviene en este análisis.

`npm test` incluye el recorrido carga → conversión → match, extracción HTML/documental, los tres veredictos, aislamiento entre solicitudes, errores de IA, límites y vencimientos, DNS/redirecciones inseguras, compresión y cancelación. Las pruebas automatizadas simulan OpenAI y la red externa. La comprobación del agente publicado debe realizarse en Copilot Studio y en el widget con los endpoints del despliegue.

## Integración del widget con Copilot (archivo o enlace)

- `POST /api/v1/documents`: carga temporal de un archivo en el campo `file`. Acepta cualquier origen, incluso peticiones sin cabecera `Origin`, y no exige API key del cliente. Aplica rate limiting, comprueba tipo/firma y limita tamaño y memoria.
- Respuesta 201: `{ source: "document", filename, mimeType, url, expiresAt }`. La URL contiene un token aleatorio de acceso; tratarla como un enlace privado. La carga no llama a OpenAI.
- `GET /api/v1/documents/:id?token=...`: descarga del archivo temporal con token. Sin token válido o después del vencimiento responde 404. No se permite cachear la respuesta.
- `POST /api/v1/convert` conserva sus entradas multipart y JSON `{ url }`, y añade `source: "document" | "link"` a su respuesta. Resuelve directamente en memoria las URL temporales propias. Un enlace externo sigue el flujo de descarga existente.

Configuración adicional:

| Variable | Default | Uso |
|---|---|---|
| `PUBLIC_BASE_URL` | Origen local de la petición | Origen HTTPS público de esta API, obligatorio en producción para Copilot |
| `DOCUMENT_UPLOAD_MAX_MB` | `10` | Máximo por archivo del widget |
| `DOCUMENT_TTL_SECONDS` | `900` | Tiempo de vida de cada documento |
| `DOCUMENT_STORE_MAX_MB` | `100` | Memoria máxima de documentos temporales |

El almacenamiento es temporal y de una sola instancia: reiniciar el proceso borra los archivos. Para varias réplicas se necesita un almacén compartido. El convertidor no exige `API_KEY` ni la cabecera `x-api-key`. `OPENAI_API_KEY` sigue configurada únicamente en el servidor para llamar a OpenAI. El tema completo está en `../Chat-Laurate/copilot/analisis-cv.yaml`.

Pruebas: `npm test` ejecuta el recorrido carga → descarga → conversión, diferencia archivos de enlaces y verifica límites y expiración. Las pruebas automatizadas usan una respuesta de IA simulada; las llamadas reales deben verificarse por separado con la configuración local.

## Características

- **Estrategia híbrida** (rápida y económica):

  | Tipo de documento | Flujo de procesamiento | Estrategia (`meta.strategy`) |
  |---|---|---|
  | PDF con texto | Extracción local (`pdf-parse`) → GPT estructura el Markdown | `local-pdf-parse+gpt` |
  | PDF escaneado | El PDF se envía directo al modelo de visión de OpenAI | `openai-pdf-vision` |
  | Word .docx | Extracción local (`mammoth`) → GPT estructura el Markdown | `local-mammoth+gpt` |
  | Imagen (JPEG/PNG/WEBP) | OCR y estructuración con GPT Vision | `openai-image-vision` |

- **Límites y validaciones**: rate limiting, límite de tamaño de archivo, whitelist de tipos con verificación de firma binaria (magic bytes) y headers de seguridad (`helmet`).
- **Documentación interactiva** de los endpoints con Swagger UI en `/docs`.

## Requisitos

- Node.js >= 18.17
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

La conversión está disponible sin autenticación del cliente en desarrollo y producción. No se utiliza `API_KEY`; se puede eliminar de las variables del despliegue. `OPENAI_API_KEY` continúa siendo obligatoria para procesar documentos con OpenAI.

## Variables de entorno

| Variable | Obligatoria | Default | Descripción |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | API key de OpenAI |
| `PORT` | No | `3000` | Puerto del servidor |
| `NODE_ENV` | No | `development` | Entorno de ejecución |
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
| `POST` | `/api/v1/convert` | Ninguna | Convierte un documento a Markdown |
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

**Enlaces de Google**: también se aceptan enlaces de Google Docs, Slides, Sheets y Google Drive — el servicio los convierte automáticamente a su URL de exportación:

| Enlace | Se exporta como |
|---|---|
| `docs.google.com/document/d/ID/...` (Google Docs) | Word `.docx` |
| `docs.google.com/presentation/d/ID/...` (Google Slides) | PDF |
| `docs.google.com/spreadsheets/d/ID/...` (Google Sheets) | PDF |
| `drive.google.com/file/d/ID/...` (archivo en Drive) | Descarga directa |

> ⚠️ El documento debe estar compartido como **"Cualquier persona con el enlace"**; de lo contrario Google no permite la descarga y el servicio responde `422 DOWNLOAD_FAILED` con la indicación correspondiente.

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

# Convertir un Google Doc compartido con enlace
curl.exe -X POST http://localhost:3000/api/v1/convert -H "Content-Type: application/json" -d "{\"url\": \"https://docs.google.com/document/d/TU_ID_DE_DOCUMENTO/edit?usp=sharing\"}"

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
├── middleware/               # Upload/validación (directa y por URL), errores
└── utils/                    # ApiError y detección de tipos de archivo (magic bytes)
```

## Limitaciones conocidas

- **PDF escaneado**: se envía a OpenAI, que admite hasta ~100 páginas / 32 MB por solicitud.
- **Word**: solo `.docx` (no el formato antiguo `.doc`).
- Documentos muy largos consumen más tokens de OpenAI (costo) y se procesan por partes.
- El rate limit es por IP y en memoria (si se despliega en múltiples instancias, considerar un store compartido como Redis).
- **Conversión por URL**: el servicio descarga desde cualquier URL http/https accesible. Si se despliega en una red interna, considera restringir los dominios permitidos para mitigar SSRF (solicitudes hacia servicios internos).
