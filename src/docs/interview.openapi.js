'use strict';
const json = schema => ({ 'application/json': { schema } });
const response = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const object = properties => ({ type: 'object', properties });
const string = { type: 'string' };
const secured = {
  tags: ['Entrevistas'], security: [{ InterviewSession: [] }],
  parameters: [{ in: 'path', name: 'id', required: true, schema: string }],
};
module.exports = {
  '/api/v1/interviews': { post: {
    tags: ['Entrevistas'], summary: 'Reserva una entrevista oral',
    description: 'Requiere INTERVIEW_ENABLED. Acepta cualquier origen y solicitudes sin Origin. Máximo tres llamadas por instancia, seis reservas por IP cada quince minutos. Una reserva sin conectar vence a los 45 segundos. El token es exclusivo de la sesión; nunca contiene la clave de OpenAI.',
    responses: { 201: response('Credencial temporal; no persistir ni registrar', object({ id: string, token: string, durationSeconds: { type: 'integer', example: 600 } })),
      429: response('Frecuencia o capacidad agotada'), 503: response('Simulador deshabilitado') },
  } },
  '/api/v1/interviews/{id}/connect': { post: { ...secured, summary: 'Negocia SDP y conecta sideband',
    requestBody: { required: true, content: json({ ...object({ sdp: { type: 'string', maxLength: 60000 } }), required: ['sdp'] }) },
    responses: { 200: response('SDP answer', object({ sdp: string })), 400: response('SDP inválido'), 404: response('Sesión o token inválido'), 409: response('Ya conectado'), 502: response('Proveedor o sideband no disponible') },
  } },
  '/api/v1/interviews/{id}/events': { get: { ...secured, summary: 'Estado, transcripción e informe por SSE',
    description: 'Usar fetch con Bearer; no poner el token en URL. Un consumidor por sesión. Cada evento data contiene status, expiresAt, phase, profile, principal, followUps, answered, transcript, report y reason. Perder este canal durante diez segundos cierra la llamada.',
    responses: { 200: { description: 'Snapshots JSON en data; heartbeats cada quince segundos', content: { 'text/event-stream': { schema: string } } }, 404: response('Sesión o token inválido'), 409: response('Sesión abierta en otro consumidor') },
  } },
  '/api/v1/interviews/{id}/ready': { post: { ...secured, summary: 'Inicia voz y reloj tras conectar WebRTC y SSE', responses: { 204: response('Iniciado o ya activo'), 409: response('Todavía no conectado') } } },
  '/api/v1/interviews/{id}/finish': { post: { ...secured, summary: 'Finaliza preguntas y genera consejos orales y escritos',
    responses: { 200: response('Informe; audio disponible hasta el cierre automático', object({ report: object({
      summary: string, strengths: { type: 'array', items: string }, improvements: { type: 'array', items: string }, nextSteps: { type: 'array', items: string }, spokenFeedback: string,
      complete: { type: 'boolean' }, answered: { type: 'integer' }, mainQuestionsAnswered: { type: 'integer' },
    }) })), 409: response('La entrevista todavía no está activa') },
  } },
  '/api/v1/interviews/{id}/end': { post: { ...secured, summary: 'Cuelga inmediatamente y libera el espacio', responses: { 204: response('Llamada terminada. Estado temporal eliminado tras cinco minutos') } } },
};
