# Simulador oral de Ciby

OpenAI Realtime proporciona voz a voz mediante WebRTC. El servidor negocia SDP con su clave permanente y abre un WebSocket sideband sobre la misma llamada. El perfil, las herramientas, el contador de preguntas, el reloj y el informe se gestionan en el servidor. No se usa ElevenLabs ni se entrega `OPENAI_API_KEY` al widget.

## Configuración y prueba local

Requiere Node.js 20 o superior y acceso/facturación para Realtime en la cuenta OpenAI. Instala dependencias con `npm install`. Conserva `OPENAI_API_KEY` y `OPENAI_TEXT_MODEL` existentes y agrega a `.env`:

```dotenv
INTERVIEW_ENABLED=true
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
INTERVIEW_MAX_SESSIONS=3
INTERVIEW_DURATION_SECONDS=900
```

La duración configurable admite 600–1200 segundos; la recomendada es 900 (15 minutos), con los últimos 90 segundos reservados para consejos. Actualiza código y variable de duración en la misma revisión de Cloud Run: el backend anterior rechaza valores menores a 990 segundos al arrancar.

Ejecuta `npm start`. En `Chat-Laurate/config.json` agrega `"interview": { "enabled": true, "base_url": "http://127.0.0.1:3000" }`. Ejecuta `npm run dev` desde `Chat-Laurate` y abre `http://127.0.0.1:8082`. Con el tema del simulador publicado, selecciona esa opción del menú o escribe «practicar entrevista laboral». El evento `ciby.interview.start` abre la sección y «Activar micrófono y empezar» solicita permiso e inicia la conversación.

Las instrucciones completas se conservan en cada `response.create`, también después de herramientas y errores. El español latinoamericano se mantiene aunque el estudiante mencione tecnologías o puestos en inglés: el prompt empieza con reglas de idioma y de audio poco claro, el reloj se envía en prosa española, cada resultado de herramienta incluye un recordatorio de idioma y el ruido transcrito sin palabras no provoca un turno del modelo. La transcripción usa un `prompt` en español y el VAD un umbral de 0,6 para reducir turnos disparados por ruido. El modelo y la voz son configurables. La transcripción usa `gpt-4o-mini-transcribe` en español y el informe usa `OPENAI_TEXT_MODEL`; todo se factura a OpenAI. El navegador necesita HTTPS o localhost. El iframe permite micrófono/autoplay; si el sitio anfitrión aplica Permissions-Policy debe permitir micrófono para ese origen. Algunos navegadores requieren pulsar «Escuchar a Ciby» para activar el audio.

## Conversación y sesión

La bienvenida recoge oralmente carrera, ciclo, puesto, prácticas/empleo, experiencia y sector. La empresa es opcional. `save_profile` conserva los datos declarados; no hay formulario. `next_question` registra cada pregunta antes de pronunciarla y el servidor valida fase, nuevo turno del estudiante y límites: seis principales (una de presentación, dos de competencias laborales, dos técnicas y una de situaciones/STAR), más un máximo de dos repreguntas. La pertinencia y el reconocimiento de una respuesta sustantiva dependen del modelo y requieren validación en el piloto. Para estudiantes sin experiencia se aceptan proyectos y ejemplos académicos.

Se puede interrumpir, silenciar el micrófono o pedir consejos por voz. `get_feedback` genera fortalezas observadas, mejoras con ejemplos y siguientes pasos a partir del perfil y las respuestas reales. Pedir consejos a mitad permite continuar; una petición de consejos no cuenta por sí sola como respuesta. No predice contratación ni puntúa personalidad o voz. El informe se muestra escrito y Realtime lee un resumen oral.

El reloj empieza después de conectar WebRTC y SSE. La sesión dura 15 minutos y no tiene tiempo mínimo: termina al responder la sexta principal, cuando el estudiante lo pide (`get_feedback` con `userRequested=true`) o por tiempo. Si el modelo intenta cerrar antes de completar las seis principales sin que el estudiante lo pida, el servidor lo rechaza. A los 13:30 se reservan 90 segundos para el cierre; a los 15 minutos se cuelga. Si faltan respuestas, el informe se marca parcial. Un informe temprano deja hasta 70 segundos para escucharlo. Volver al chat o cerrar la burbuja detiene las pistas y solicita hangup. El widget renueva SSE cada cuatro minutos y reconecta con las mismas credenciales, conservando audio, transcripción y vencimiento. Una nueva conexión SSE con el mismo token reemplaza y cierra la anterior: detrás de Cloud Run el contenedor puede no enterarse de que el cliente cerró la petición previa, y rechazar la renovación con 409 cortaba la entrevista hacia el minuto 4. Perder el canal de control durante treinta segundos o apagar el servidor también cierra la llamada. No se modifica el estado de Flowise ni los recorridos de CV/match.

Los errores del proveedor no cierran la llamada: `conversation_already_has_active_response` reenvía la respuesta al terminar la activa, otros errores de `response.create` se reintentan y `response.done` con estado `failed` se reintenta hasta tres veces con espera creciente. Solo una racha de cinco errores sin respuestas correctas, el cierre del sideband o el corte de WebRTC terminan la sesión. El sideband envía un ping cada 25 segundos.

Para diagnóstico se registran en stdout (Cloud Logging) eventos JSON `interview_end` (motivo y segundos transcurridos), `interview_provider_error` y `interview_response_failed` (tipo y código) e `interview_ws_close` (código), con un prefijo del id de sesión. Nunca incluyen mensajes del proveedor, audio, perfil, transcripción ni informe.

El estado está aislado por credenciales aleatorias y solo vive en memoria. La aplicación no escribe audio, perfil, transcripción ni informe en una base de datos o logs. El estado se elimina cinco minutos después de terminar; recargar o reiniciar pierde la sesión. La política de retención de OpenAI y la configuración de la cuenta se aplican por separado.

## API

Swagger documenta el contrato en `/docs`. Todas las rutas aceptan cualquier origen y solicitudes sin cabecera `Origin`; CORS permite `*`. Crear tiene un límite de seis reservas por IP cada quince minutos y tres sesiones activas por instancia. Una reserva sin conectar vence a los 45 segundos. Los demás endpoints requieren `Authorization: Bearer <token de sesión>`; no persistir el token ni incluirlo en URLs/logs.

| Método y ruta | Acción |
|---|---|
| `POST /api/v1/interviews` | Reserva: `id`, `token`, `durationSeconds` |
| `POST /api/v1/interviews/:id/connect` | JSON `{sdp}`; devuelve SDP answer y conecta sideband |
| `GET /api/v1/interviews/:id/events` | SSE autenticado con estado, transcripción e informe |
| `POST /api/v1/interviews/:id/ready` | Inicia voz y reloj tras conectar WebRTC y SSE |
| `POST /api/v1/interviews/:id/finish` | Genera el informe final y solicita su lectura |
| `POST /api/v1/interviews/:id/end` | Cuelga y libera espacio |

El navegador no ejecuta las herramientas del modelo ni envía las reglas. Cada herramienta se procesa una vez por `call_id`. Si falla la evaluación se muestra el fallo y orientación general, sin fabricar una valoración individual.

## Publicación del piloto

1. Despliega el backend con `INTERVIEW_ENABLED=true`. El simulador acepta peticiones desde cualquier página sin configurar una lista de orígenes.
2. Mantén **una sola instancia y un solo proceso Node**: tanto el estado como el aforo son locales. Para escalar hace falta estado compartido y asignar cada llamada al proceso que mantiene su sideband.
3. En Cloud Run configura timeout HTTP de 1500 segundos y concurrencia de 20 para SSE, controles y conversiones. SSE mantiene una petición activa. Estos ajustes deben aplicarse en infraestructura; el código no los cambia. Evita despliegues durante las prácticas porque reiniciar interrumpe las llamadas.
4. Cambia `interview.base_url` al origen HTTPS del backend, ejecuta `npm run build` en `Chat-Laurate` y publica el widget. No publiques el build local con URL localhost. El modo `build:split` también incorpora el simulador y exige publicar ambos archivos.
5. Crea el tema desde `Chat-Laurate/copilot/simulador-entrevista.yaml`, vincula el botón «Simulador de entrevistas» del menú a ese tema y publica el agente correcto. El evento `ciby.interview.start` abre la sección. El panel de prueba de Copilot Studio no incorpora esta interfaz de voz.
6. Valida con micrófono real en escritorio y móvil: bienvenida, perfil oral, cuatro fases, interrupciones, silencio, consejos a mitad, cierre temprano, cierre tras seis principales, consejos a los 13:30, límite de quince minutos y tres sesiones. Confirma voz/idioma y acceso desde las páginas que alojarán el widget.

Instalar el código no publica automáticamente el backend, widget ni tema. En el despliegue del backend corregido configura simultáneamente `INTERVIEW_DURATION_SECONDS=900`. Después verifica los ajustes en el proyecto de Google Cloud correspondiente:

```sh
gcloud run services update services-ai-convert \
  --project=gen-ai-services \
  --region=europe-west1 \
  --timeout=1500s \
  --concurrency=20 \
  --max-instances=1 \
  --no-cpu-throttling \
  --update-env-vars=INTERVIEW_DURATION_SECONDS=900
```

La duración configurable admite 600–1200 segundos; la recomendada es 900 (15 minutos), con los últimos 90 segundos reservados para consejos. Actualiza código y variable de duración en la misma revisión de Cloud Run: el backend anterior rechaza valores menores a 990 segundos al arrancar.

`--no-cpu-throttling` mantiene CPU para el sideband, los temporizadores y el hangup aunque no haya peticiones HTTP en curso. `--update-env-vars` conserva las demás variables y secretos existentes. Esta orden ajusta la infraestructura y duración; no sube el código. Verifica que el mecanismo de despliegue posterior conserve estos valores. Cloud Run usa por defecto un [timeout de 300 segundos](https://docs.cloud.google.com/run/docs/configuring/request-timeout), que afecta la petición SSE. La renovación/reconexión del widget evita que ese corte HTTP cuelgue por sí solo el audio; no recupera una instancia reiniciada, porque el estado sigue en memoria.

## Fuentes y comprobaciones

La base institucional usada se limita a empleabilidad en [Base_Conocimiento_Ciby](https://docs.google.com/spreadsheets/d/19TuupTc4EM4sG37V6WwzdZB3qe1o0ef2/edit) y [Ciby_Insumos_Mesa_Trabajo 23JUN](https://docs.google.com/document/d/13dS16K-QK24HGPxEORkodN6Lm3_oZ-R_/edit): preparación de CV, entrevistas, orientación, talleres y mentoría. Preguntas contextualizadas y STAR son preparación general, no un banco oficial de preguntas de Cibertec o de empresas.

Se siguió documentación oficial de [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime&voice-api=realtime), [sideband](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime&voice-api=realtime) y [hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).

`npm test` cubre aislamiento, credenciales, orígenes, aforo, expiración, fases, repreguntas, informes parciales, idempotencia, desconexión y límite de tiempo con un proveedor simulado. El widget prueba denegación de permisos, cierre durante la solicitud de micrófono, negociación/control, silencio, informe seguro y limpieza al cerrar. No sustituye la validación oral con usuarios.

Las pruebas de regresión verifican la política española en cada respuesta y puente de herramientas, el reloj en prosa española, que el ruido no provoque turnos, el rechazo del cierre del modelo antes de seis principales, el cierre sin tiempo mínimo, el límite de 15 minutos, el reemplazo de una conexión SSE por otra con el mismo token, la recuperación de errores del proveedor y respuestas fallidas, y que los logs no contengan mensajes del proveedor. En el widget se simulan 16 minutos con cuatro renovaciones SSE, cortes HTTP, errores temporales, credenciales vencidas y recuperación breve de WebRTC. Estas pruebas usan reloj y proveedor simulados; no equivalen a una llamada oral de 20 minutos en producción.
