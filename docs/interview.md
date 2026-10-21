# Simulador oral de Ciby

OpenAI Realtime proporciona voz a voz mediante WebRTC. El servidor negocia SDP con su clave permanente y abre un WebSocket sideband sobre la misma llamada. El perfil, las herramientas, el contador de preguntas, el reloj y el informe se gestionan en el servidor. No se usa ElevenLabs ni se entrega `OPENAI_API_KEY` al widget.

## Configuración y prueba local

Requiere Node.js 20 o superior y acceso/facturación para Realtime en la cuenta OpenAI. Instala dependencias con `npm install`. Conserva `OPENAI_API_KEY` y `OPENAI_TEXT_MODEL` existentes y agrega a `.env`:

```dotenv
INTERVIEW_ENABLED=true
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
INTERVIEW_MAX_SESSIONS=3
INTERVIEW_DURATION_SECONDS=600
```

Ejecuta `npm start`. En `Chat-Laurate/config.json` agrega `"interview": { "enabled": true, "base_url": "http://127.0.0.1:3000" }`. Ejecuta `npm run dev` desde `Chat-Laurate` y abre `http://127.0.0.1:8082`. Con el tema del simulador publicado, selecciona esa opción del menú o escribe «practicar entrevista laboral». El evento `ciby.interview.start` abre la sección y «Activar micrófono y empezar» solicita permiso e inicia la conversación.

El modelo y la voz son configurables. La transcripción usa `gpt-4o-mini-transcribe` en español y el informe usa `OPENAI_TEXT_MODEL`; todo se factura a OpenAI. El navegador necesita HTTPS o localhost. El iframe permite micrófono/autoplay; si el sitio anfitrión aplica Permissions-Policy debe permitir micrófono para ese origen. Algunos navegadores requieren pulsar «Escuchar a Ciby» para activar el audio.

## Conversación y sesión

La bienvenida recoge oralmente carrera, ciclo, puesto, prácticas/empleo, experiencia y sector. La empresa es opcional. `save_profile` conserva los datos declarados; no hay formulario. `next_question` registra cada pregunta antes de pronunciarla y el servidor valida fase, nuevo turno del estudiante y límites: ocho principales, dos por fase (presentación, competencias laborales, técnicas y situaciones/STAR), más un máximo de dos repreguntas. La pertinencia y el reconocimiento de una respuesta sustantiva dependen del modelo y requieren validación en el piloto. Para estudiantes sin experiencia se aceptan proyectos y ejemplos académicos.

Se puede interrumpir, silenciar el micrófono o pedir consejos por voz. `get_feedback` genera fortalezas observadas, mejoras con ejemplos y siguientes pasos a partir del perfil y las respuestas reales. Pedir consejos a mitad permite continuar; una petición de consejos no cuenta por sí sola como respuesta. No predice contratación ni puntúa personalidad o voz. El informe se muestra escrito y Realtime lee un resumen oral.

El reloj empieza después de conectar WebRTC y SSE. A los 8:30 se reservan 90 segundos para el cierre; a los diez minutos se cuelga. Si faltan respuestas, el informe se marca parcial. Un informe temprano deja hasta 70 segundos para escucharlo. Volver al chat o cerrar la burbuja detiene las pistas y solicita hangup. Perder el canal de control durante diez segundos o apagar el servidor también cierra la llamada. No se modifica el estado de Flowise ni los recorridos de CV/match.

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
3. En Cloud Run configura timeout HTTP de al menos 900 segundos y concurrencia de al menos 10 para SSE, controles y conversiones. SSE mantiene una petición activa. Estos ajustes deben aplicarse en infraestructura; el código no los cambia. Evita despliegues durante las prácticas porque reiniciar interrumpe las llamadas.
4. Cambia `interview.base_url` al origen HTTPS del backend, ejecuta `npm run build` en `Chat-Laurate` y publica el widget. No publiques el build local con URL localhost. El modo `build:split` también incorpora el simulador y exige publicar ambos archivos.
5. Crea el tema desde `Chat-Laurate/copilot/simulador-entrevista.yaml`, vincula el botón «Simulador de entrevistas» del menú a ese tema y publica el agente correcto. El evento `ciby.interview.start` abre la sección. El panel de prueba de Copilot Studio no incorpora esta interfaz de voz.
6. Valida con micrófono real en escritorio y móvil: bienvenida, perfil oral, cuatro fases, interrupciones, silencio, consejos a mitad, cierre temprano, límite de diez minutos y tres sesiones. Confirma voz/idioma y acceso desde las páginas que alojarán el widget.

Instalar el código no publica automáticamente el backend, widget ni tema.

## Fuentes y comprobaciones

La base institucional usada se limita a empleabilidad en [Base_Conocimiento_Ciby](https://docs.google.com/spreadsheets/d/19TuupTc4EM4sG37V6WwzdZB3qe1o0ef2/edit) y [Ciby_Insumos_Mesa_Trabajo 23JUN](https://docs.google.com/document/d/13dS16K-QK24HGPxEORkodN6Lm3_oZ-R_/edit): preparación de CV, entrevistas, orientación, talleres y mentoría. Preguntas contextualizadas y STAR son preparación general, no un banco oficial de preguntas de Cibertec o de empresas.

Se siguió documentación oficial de [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime&voice-api=realtime), [sideband](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime&voice-api=realtime) y [hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).

`npm test` cubre aislamiento, credenciales, orígenes, aforo, expiración, fases, repreguntas, informes parciales, idempotencia, desconexión y límite de tiempo con un proveedor simulado. El widget prueba denegación de permisos, cierre durante la solicitud de micrófono, negociación/control, silencio, informe seguro y limpieza al cerrar. No sustituye la validación oral con usuarios.
