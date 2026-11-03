'use strict';
process.env.OPENAI_API_KEY = 'synthetic-test-key';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { EventEmitter } = require('node:events');
const { InterviewService } = require('../src/services/interview.service');
const { createProvider } = require('../src/services/interview-provider');
const { createInterviewRouter } = require('../src/routes/interview.routes');
const { errorHandler } = require('../src/middleware/errorHandler.middleware');
const { phases, instructions, mainQuestions, phaseFor, languageReminder } = require('../src/services/interview-prompt');
const profile = { career: 'Computación', cycle: 'Cuarto', role: 'Desarrollador backend', objective: 'Prácticas', experience: 'Sin experiencia', sector: 'Tecnología' };
const report = { summary: 'Usaste un ejemplo académico.', strengths: ['Describiste una acción propia.'], improvements: ['Explica un resultado verificable.'], nextSteps: ['Prepara otro ejemplo STAR.'], spokenFeedback: 'En tu ejemplo académico explicaste tu acción; añade el resultado.' };
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const sent = [], timers = [], closed = [], reports = [], logs = [];
  let event;
  const service = new InterviewService({
    provider: { connect: async (sdp, onEvent) => { event = onEvent; return { answer: 'v=0\r\nanswer', send: e => sent.push(e), close: async () => closed.push(true) }; },
      feedback: async data => { reports.push(data); return structuredClone(report); }, ...options.provider },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: t => { if (t) t.cleared = true; },
    now: () => 1000, log: entry => logs.push(entry), ...options,
  });
  const credentials = service.create(); const session = service.authorize(credentials.id, credentials.token);
  async function ready() { await service.connect(session, offer); service.subscribe(session, () => {}); service.ready(session); return session; }
  function answer(i) { service.onEvent(session, { type: 'input_audio_buffer.committed', item_id: `u${i}` }); service.onEvent(session, { type: 'conversation.item.input_audio_transcription.completed', item_id: `u${i}`, transcript: `Respuesta académica ${i}.` }); }
  const creates = () => sent.filter(e => e.type === 'response.create');
  return { service, session, credentials, sent, timers, closed, reports, logs, creates, ready, answer, event: e => event(e) };
}

test('reserves at most three sessions, uses scoped secrets, expires reservations and purges private data', async () => {
  const h = harness();
  assert.throws(() => h.service.authorize(h.credentials.id, 'wrong'), /no existe/);
  h.service.create(); h.service.create();
  assert.throws(() => h.service.create(), /ocupados/);
  await h.timers.find(t => t.ms === 45000).fn();
  assert.equal(h.session.status, 'ended');
  assert.ok(h.service.create());
  h.session.transcript.push({ text: 'private' });
  h.timers.find(t => t.ms === 300000).fn();
  assert.equal(h.service.sessions.has(h.credentials.id), false);
  assert.deepEqual(h.session.transcript, []);
});

test('server controls profile, four ordered phases, 6 main questions and complete feedback', async () => {
  const h = harness(); await h.ready();
  let result = await h.service.tool(h.session, 'next_question', { question: 'Cuéntame tu experiencia.', phase: phases[0], followUp: false });
  assert.equal(result.missing.length, 6);
  await h.service.tool(h.session, 'save_profile', profile);
  const expected = ['Presentación', 'Competencias laborales', 'Competencias laborales', 'Competencias técnicas', 'Competencias técnicas', 'Situaciones y STAR'];
  assert.equal(mainQuestions, 6);
  for (let i = 0; i < mainQuestions; i++) {
    if (i) h.answer(i);
    result = await h.service.tool(h.session, 'next_question', { question: `Pregunta contextual ${i}?`, phase: expected[i], followUp: false });
    assert.equal(result.phase, expected[i]); assert.equal(result.totalPrincipal, 6);
    const duplicate = await h.service.tool(h.session, 'next_question', { question: 'Una pregunta que no debe avanzar?', phase: result.nextPhase, followUp: false });
    assert.match(duplicate.error, /Espera/);
  }
  const early = await h.service.tool(h.session, 'get_feedback', { finish: true, answeredCurrentQuestion: false });
  assert.equal(early.finished, false); assert.match(early.instruction, /faltan preguntas principales/);
  assert.equal(h.session.status, 'active'); assert.equal(h.reports.length, 0);
  h.answer(6);
  result = await h.service.tool(h.session, 'get_feedback', { finish: true, answeredCurrentQuestion: true });
  assert.equal(h.session.status, 'feedback');
  assert.equal(result.report.complete, true);
  assert.equal(result.report.mainQuestionsAnswered, 6); assert.equal(result.report.totalPrincipal, 6);
  assert.equal(h.reports[0].transcript.length, 6);
  assert.match((await h.service.tool(h.session, 'next_question', {})).error, /cerrando/);
});

test('rejects skipped phases and limits follow-ups to two without advancing principal count', async () => {
  const h = harness(); await h.ready(); await h.service.tool(h.session, 'save_profile', profile);
  assert.match((await h.service.tool(h.session, 'next_question', { question: 'Salta a tecnología?', phase: phases[2], followUp: false })).error, /Fase/);
  await h.service.tool(h.session, 'next_question', { question: 'Cuéntame sobre tu motivación?', phase: phases[0], followUp: false });
  for (let i = 1; i <= 2; i++) { h.answer(i); await h.service.tool(h.session, 'next_question', { question: 'Qué hiciste tú en ese proyecto?', phase: phases[0], followUp: true }); }
  h.answer(3);
  assert.match((await h.service.tool(h.session, 'next_question', { question: 'Una tercera repregunta?', phase: phases[0], followUp: true })).error, /límite/);
  assert.equal(h.session.principal, 1); assert.equal(h.session.followUps, 2);
});

test('feedback on request is partial, cached and allows continuation; sessions remain isolated', async () => {
  const h = harness(); await h.ready(); await h.service.tool(h.session, 'save_profile', profile);
  await h.service.tool(h.session, 'next_question', { question: 'Cuéntame un logro académico?', phase: phases[0], followUp: false }); h.answer(1);
  const result = await h.service.tool(h.session, 'get_feedback', { finish: false, answeredCurrentQuestion: true });
  assert.equal(result.report.complete, false); assert.equal(result.report.mainQuestionsAnswered, 1); assert.equal(h.session.status, 'active');
  await h.service.tool(h.session, 'get_feedback', { finish: false }); assert.equal(h.reports.length, 1);
  const other = h.service.create(); assert.deepEqual(h.service.authorize(other.id, other.token).profile, {});
});

test('time limit reserves 90 seconds for feedback and always closes provider; disconnect and shutdown close too', async () => {
  const h = harness(); await h.ready();
  await h.timers.find(t => t.ms === 810000).fn(); await settle();
  assert.equal(h.session.status, 'feedback'); assert.equal(h.session.report.complete, false);
  await h.timers.find(t => t.ms === 900000).fn(); assert.equal(h.closed.length, 1); assert.equal(h.session.status, 'ended');
  assert.ok(h.logs.some(l => l.event === 'interview_end' && l.reason === 'time_limit'));
  const orphan = harness(); await orphan.service.connect(orphan.session, offer); const unsub = orphan.service.subscribe(orphan.session, () => {}); unsub();
  await orphan.timers.find(t => t.ms === 30000).fn(); assert.equal(orphan.closed.length, 1);
  const shutdown = harness(); await shutdown.ready(); await shutdown.service.shutdown(); assert.equal(shutdown.closed.length, 1);
});

test('provider errors release the slot and failed feedback never fabricates an assessment', async () => {
  const broken = harness({ provider: { connect: async () => { throw new Error('synthetic'); } } });
  await assert.rejects(broken.service.connect(broken.session, offer)); assert.equal(broken.session.status, 'ended');
  const h = harness(); h.service.provider.feedback = async () => { throw new Error('synthetic'); }; await h.ready();
  const result = await h.service.finish(h.session);
  assert.equal(result.complete, false); assert.deepEqual(result.strengths, []); assert.match(result.summary, /No se pudo/);
});

test('sideband executes each tool once and browser never needs model tools or API key', async () => {
  const h = harness(); await h.ready();
  const done = { type: 'response.done', response: { output: [{ type: 'function_call', call_id: 'call_1', name: 'save_profile', arguments: JSON.stringify(profile) }] } };
  h.event(done); await settle(); h.event(done); await settle();
  assert.equal(h.sent.filter(e => e.item?.type === 'function_call_output').length, 1);
  assert.ok(!JSON.stringify(h.credentials).includes('synthetic-test-key'));
});

test('HTTP lifecycle accepts every origin, rejects wrong capabilities and invalid offers; streams state', async () => {
  const h = harness(); const app = express(); app.use(cors()); app.use(express.json());
  app.use('/api/v1/interviews', createInterviewRouter({ service: h.service, enabled: true })); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/interviews`;
  const headers = { origin: 'https://widget.example', 'Content-Type': 'application/json' };
  try {
    for (const origin of [undefined, 'http://localhost:9090', 'https://portal.example', 'null']) {
      const originHeaders = origin === undefined ? {} : { origin };
      const response = await fetch(base, { method: 'POST', headers: originHeaders });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      const credentials = await response.json();
      const closed = await fetch(`${base}/${credentials.id}/end`, { method: 'POST', headers: { ...originHeaders, Authorization: `Bearer ${credentials.token}` } });
      assert.equal(closed.status, 204);
    }
    const preflight = await fetch(base, { method: 'OPTIONS', headers: { origin: 'https://another.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
    const created = await fetch(base, { method: 'POST', headers }); assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
    const session = await created.json(); const auth = { ...headers, Authorization: `Bearer ${session.token}` };
    assert.equal((await fetch(`${base}/${session.id}/ready`, { method: 'POST', headers })).status, 404);
    assert.equal((await fetch(`${base}/${session.id}/connect`, { method: 'POST', headers: auth, body: JSON.stringify({ sdp: 'invalid' }) })).status, 400);
    const connected = await fetch(`${base}/${session.id}/connect`, { method: 'POST', headers: auth, body: JSON.stringify({ sdp: offer }) }); assert.equal(connected.status, 200);
    const controller = new AbortController();
    const events = await fetch(`${base}/${session.id}/events`, { headers: auth, signal: controller.signal });
    const reader = events.body.getReader(); const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /"status":"connected"/);
    assert.equal((await fetch(`${base}/${session.id}/ready`, { method: 'POST', headers: auth })).status, 204);
    // Renovación del widget: la segunda conexión con el mismo token reemplaza a la primera.
    const renewed = await fetch(`${base}/${session.id}/events`, { headers: auth, signal: controller.signal });
    assert.equal(renewed.status, 200);
    assert.match(new TextDecoder().decode((await renewed.body.getReader().read()).value), /"status":"active"/);
    let chunk; do { chunk = await reader.read(); } while (!chunk.done);
    const live = h.service.authorize(session.id, session.token);
    assert.equal(live.status, 'active'); assert.equal(live.listeners.size, 1);
    assert.equal((await fetch(`${base}/${session.id}/end`, { method: 'POST', headers: auth })).status, 204);
    controller.abort();
  } finally { server.closeAllConnections(); server.close(); }
});

test('unified SDP handshake keeps key on server, configures server VAD and attaches the correct sideband call', async () => {
  const requests = []; let socket;
  class Socket extends EventEmitter {
    constructor(url, options) { super(); Object.assign(this, { url, options, readyState: 1 }); socket = this; setImmediate(() => this.emit('open')); }
    send() {} terminate() { this.readyState = 3; }
  }
  const provider = createProvider({ Socket, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/hangup') ? new Response(null, { status: 200 }) : new Response('sdp-answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_synthetic' } });
  } });
  const connection = await provider.connect(offer, () => {}, () => {});
  const settings = JSON.parse(requests[0].options.body.get('session'));
  assert.equal(settings.type, 'realtime'); assert.equal(settings.audio.input.turn_detection.create_response, false);
  assert.equal(settings.audio.output.voice, 'marin'); assert.equal(settings.tools.length, 3);
  assert.equal(settings.audio.input.transcription.language, 'es'); assert.match(settings.audio.input.transcription.prompt, /español/);
  assert.equal(settings.audio.input.turn_detection.threshold, 0.6);
  assert.match(socket.url, /call_id=rtc_synthetic$/); assert.equal(socket.options.headers.Authorization, 'Bearer synthetic-test-key');
  assert.equal(connection.answer, 'sdp-answer'); await connection.close(); assert.match(requests[1].url, /\/hangup$/);
});

test('requesting feedback without answering never counts the pending question as answered', async () => {
  const h = harness(); await h.ready(); await h.service.tool(h.session, 'save_profile', profile);
  await h.service.tool(h.session, 'next_question', { question: 'Cuéntame tu motivación?', phase: phases[0], followUp: false });
  h.service.onEvent(h.session, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'stop', transcript: 'Quiero terminar y recibir consejos.' });
  const output = await h.service.tool(h.session, 'get_feedback', { finish: true, userRequested: true, answeredCurrentQuestion: false });
  assert.equal(output.report.answered, 0); assert.equal(output.report.complete, false);
});

test('OpenAPI scopes bearer authentication to interview controls and leaves CV endpoints public', () => {
  const spec = require('../src/docs/swagger');
  assert.deepEqual(spec.paths['/api/v1/interviews/{id}/connect'].post.security, [{ InterviewSession: [] }]);
  assert.equal(spec.paths['/api/v1/interviews'].post.security, undefined);
  assert.equal(spec.paths['/api/v1/cv-match'].post.security, undefined);
  assert.equal(spec.security, undefined);
});


test('Spanish policy survives welcome, transcription failure, tool bridge and final feedback', async () => {
  const h = harness(); await h.ready();
  h.event({ type: 'response.done', response: { output: [] } });
  h.event({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'failed1' });
  h.event({ type: 'response.done', response: { output: [{ type: 'function_call', call_id: 'profile1', name: 'save_profile', arguments: JSON.stringify(profile) }] } });
  await settle();
  h.event({ type: 'response.done', response: { output: [] } });
  await h.service.finish(h.session);
  h.event({ type: 'response.done', response: { output: [] } });
  const responses = h.creates();
  assert.ok(responses.length >= 4);
  for (const response of responses) {
    assert.ok(response.response.instructions.startsWith(instructions));
    assert.match(response.response.instructions, /No cambies al inglés/);
    assert.match(response.response.instructions, /Responde exclusivamente en español/);
    // El reloj va en prosa española, sin claves JSON en inglés.
    assert.match(response.response.instructions, /Tiempo transcurrido: 0 min de 15 min; quedan 15 min\./);
    assert.doesNotMatch(response.response.instructions, /elapsedSeconds|maximumSeconds/);
  }
  const output = h.sent.find(e => e.item?.type === 'function_call_output');
  assert.equal(JSON.parse(output.item.output).idioma, languageReminder);
});

test('15-minute session has no minimum: closes after six main answers or on explicit request', async () => {
  let clock = 1000;
  const h = harness({ now: () => clock }); await h.ready(); clock += 180000;
  assert.equal(h.credentials.durationSeconds, 900);
  const result = await h.service.tool(h.session, 'get_feedback', { finish: true, answeredCurrentQuestion: false });
  assert.equal(result.finished, false); assert.equal(h.session.status, 'active'); assert.equal(h.reports.length, 0);
  assert.equal(result.elapsedSeconds, 180); assert.equal(result.remainingSeconds, 720);
  const ended = await h.service.tool(h.session, 'get_feedback', { finish: true, userRequested: true, answeredCurrentQuestion: false });
  assert.equal(ended.finished, true); assert.equal(ended.report.complete, false);
  const closing = await h.service.tool(h.session, 'get_feedback', { finish: true, answeredCurrentQuestion: false });
  assert.equal(closing.finished, true);
  // Sin reloj mínimo: la sexta respuesta cierra aunque haya pasado poco tiempo.
  const fast = harness(); await fast.ready(); await fast.service.tool(fast.session, 'save_profile', profile);
  for (let i = 0; i < mainQuestions; i++) {
    if (i) fast.answer(i);
    await fast.service.tool(fast.session, 'next_question', { question: `Pregunta breve número ${i}?`, phase: phaseFor(i), followUp: false });
  }
  fast.answer(mainQuestions);
  const closed = await fast.service.tool(fast.session, 'next_question', { question: 'Una séptima principal que no se registra?', phase: phases[3], followUp: false });
  assert.equal(closed.finished, true); assert.equal(closed.report.complete, true); assert.equal(fast.session.status, 'feedback');
  assert.equal(fast.session.principal, mainQuestions);
});

test('SSE reconnect preserves the session, transcript and deadline without closing the provider', async () => {
  const h = harness(); await h.ready(); h.answer(1);
  const deadline = h.session.expiresAt;
  // Simulate a proxy ending the first HTTP request.
  h.session.listeners.clear();
  const first = h.service.subscribe(h.session, () => {}); first();
  const orphan = h.timers.find(t => t.ms === 30000);
  let state;
  const second = h.service.subscribe(h.session, value => { state = value; });
  h.service.ready(h.session);
  assert.equal(orphan.cleared, true); assert.equal(h.closed.length, 0);
  assert.equal(state.expiresAt, deadline); assert.equal(state.transcript.length, 1);
  assert.equal(h.session.status, 'active');
  second(); await h.service.end(h.session);
});

test('a new SSE subscription replaces the previous one; the late close of the old request does not orphan the call', async () => {
  const h = harness(); await h.ready();
  let closedFirst = 0, state;
  const first = h.service.subscribe(h.session, () => {}, () => { closedFirst++; });
  const second = h.service.subscribe(h.session, value => { state = value; });
  assert.equal(closedFirst, 1); assert.equal(h.session.listeners.size, 1);
  first();
  assert.equal(h.timers.some(t => t.ms === 30000 && !t.cleared), false);
  assert.equal(state.status, 'active'); assert.equal(h.session.status, 'active'); assert.equal(h.closed.length, 0);
  second();
  assert.equal(h.timers.some(t => t.ms === 30000 && !t.cleared), true);
});

test('busy and unknown provider errors keep the call and resend; a streak of errors ends it with a logged reason', async () => {
  const h = harness(); await h.ready();
  const [welcome] = h.creates();
  h.event({ type: 'error', error: { type: 'invalid_request_error', code: 'conversation_already_has_active_response', message: 'Juan Pérez dijo algo privado', event_id: welcome.event_id } });
  assert.equal(h.session.status, 'active'); assert.equal(h.creates().length, 1);
  h.event({ type: 'response.done', response: { status: 'completed', output: [] } });
  assert.equal(h.creates().length, 2); assert.match(h.creates()[1].response.instructions, /bienvenida/);
  h.event({ type: 'response.created' });
  h.event({ type: 'error', error: { type: 'server_error', code: 'synthetic' } });
  assert.equal(h.session.status, 'active');
  for (let i = 0; i < 4; i++) h.event({ type: 'error', error: { type: 'server_error', code: 'synthetic' } });
  assert.equal(h.session.status, 'ended'); assert.equal(h.session.reason, 'provider_error');
  assert.ok(h.logs.some(l => l.event === 'interview_end' && l.reason === 'provider_error'));
  assert.ok(h.logs.some(l => l.event === 'interview_provider_error' && l.code === 'conversation_already_has_active_response'));
  assert.doesNotMatch(JSON.stringify(h.logs), /Juan|privado/);
});

test('a busy error without the matching response.done is released by the watchdog', async () => {
  const h = harness(); await h.ready();
  h.event({ type: 'error', error: { type: 'invalid_request_error', code: 'conversation_already_has_active_response', event_id: h.creates()[0].event_id } });
  await h.timers.find(t => t.ms === 8000 && !t.cleared).fn();
  assert.equal(h.creates().length, 2); assert.equal(h.session.status, 'active');
});

test('failed responses are retried with backoff and end the call after three retries', async () => {
  const h = harness(); await h.ready();
  const failed = { type: 'response.done', response: { status: 'failed', status_details: { error: { type: 'server_error', code: 'synthetic' } }, output: [] } };
  for (let attempt = 1; attempt <= 3; attempt++) {
    h.event(failed);
    assert.equal(h.session.status, 'active');
    await h.timers.filter(t => t.ms === 1000 * 2 ** (attempt - 1) && !t.cleared).at(-1).fn();
    assert.equal(h.creates().length, attempt + 1);
  }
  h.event(failed);
  assert.equal(h.session.status, 'ended'); assert.equal(h.session.reason, 'provider_error');
  assert.ok(h.logs.some(l => l.event === 'interview_response_failed' && l.code === 'synthetic'));
});

test('noise or silence does not trigger a model turn unless it cut Ciby off', async () => {
  const h = harness(); await h.ready();
  h.event({ type: 'response.done', response: { status: 'completed', output: [] } });
  const before = h.creates().length;
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'n1', transcript: '  ...  ' });
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'n2', transcript: '' });
  assert.equal(h.creates().length, before); assert.equal(h.session.transcript.length, 0);
  h.event({ type: 'response.created' }); h.event({ type: 'response.done', response: { status: 'cancelled', output: [] } });
  h.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'n3', transcript: '' });
  assert.equal(h.creates().length, before + 1); assert.match(h.creates().at(-1).response.instructions, /Retómala/);
  h.event({ type: 'response.done', response: { status: 'completed', output: [] } });
  h.answer(1);
  assert.equal(h.creates().length, before + 2); assert.equal(h.session.transcript.length, 1);
});
