'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { ApiError } = require('../utils/errors');
const { phases, profileFields } = require('./interview-prompt');

const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const token = () => randomBytes(24).toString('base64url');

class InterviewService {
  constructor({ provider, maxSessions = 3, durationSeconds = 600, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { provider, maxSessions, durationSeconds, now, setTimer, clearTimer });
    this.sessions = new Map();
  }
  later(fn, ms) { const timer = this.setTimer(fn, ms); timer.unref?.(); return timer; }
  create() {
    if ([...this.sessions.values()].filter(s => s.status !== 'ended').length >= this.maxSessions) fail(429, 'INTERVIEW_FULL', 'Los tres espacios de práctica están ocupados. Intenta nuevamente en unos minutos.');
    const s = { id: token(), token: token(), status: 'reserved', profile: {}, questions: [], transcript: [], userItems: new Set(), calls: new Set(),
      listeners: new Set(), timers: [], principal: 0, followUps: 0, answerVersion: 0, consumedVersion: 0, queue: Promise.resolve() };
    s.timers.push(this.later(() => this.end(s, 'not_connected'), 45000));
    this.sessions.set(s.id, s);
    return { id: s.id, token: s.token, durationSeconds: this.durationSeconds };
  }
  authorize(id, secret) {
    const s = this.sessions.get(id);
    if (!s || typeof secret !== 'string' || Buffer.byteLength(secret) !== Buffer.byteLength(s.token) || !timingSafeEqual(Buffer.from(secret), Buffer.from(s.token))) fail(404, 'INTERVIEW_NOT_FOUND', 'La sesión no existe o ha vencido. Inicia otra práctica.');
    return s;
  }
  snapshot(s) {
    return { status: s.status, expiresAt: s.expiresAt || null, profile: s.profile, phase: s.status === 'feedback' ? 'Retroalimentación' : (s.questions.at(-1)?.phase || 'Conozcámonos'),
      principal: s.principal, followUps: s.followUps, answered: s.questions.filter(q => q.answerId).length, transcript: s.transcript, report: s.report || null, reason: s.reason || null };
  }
  emit(s) { const data = this.snapshot(s); for (const listener of s.listeners) listener(data); }
  subscribe(s, listener) {
    if (s.listeners.size) fail(409, 'INTERVIEW_ALREADY_OPEN', 'Esta sesión ya está abierta.');
    this.clearTimer(s.orphanTimer);
    s.listeners.add(listener); listener(this.snapshot(s));
    return () => {
      s.listeners.delete(listener);
      if (s.status !== 'ended') s.orphanTimer = this.later(() => this.end(s, 'disconnected'), 10000);
    };
  }
  async connect(s, sdp) {
    if (s.status !== 'reserved') fail(409, 'INTERVIEW_ALREADY_CONNECTED', 'La sesión ya se ha conectado.');
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 60000 || !sdp.includes('m=audio')) fail(400, 'INVALID_SDP', 'La solicitud de audio no es válida.');
    s.status = 'connecting';
    try {
      const connection = await this.provider.connect(sdp, event => this.onEvent(s, event), () => this.end(s, 'provider_disconnected'));
      // La pestaña puede cerrarse mientras el proveedor negocia.
      if (s.status === 'ended') { await connection.close(); fail(410, 'INTERVIEW_EXPIRED', 'La sesión ha terminado.'); }
      s.connection = connection;
      s.status = 'connected';
      return { sdp: connection.answer };
    } catch (error) { await this.end(s, 'connection_error'); throw error; }
  }
  ready(s) {
    if (s.status === 'active' || s.status === 'feedback') return;
    if (s.status !== 'connected' || !s.listeners.size) fail(409, 'INTERVIEW_NOT_READY', 'Primero conecta el audio y el control de la sesión.');
    for (const t of s.timers) this.clearTimer(t);
    s.status = 'active'; s.expiresAt = this.now() + this.durationSeconds * 1000;
    s.timers = [
      this.later(() => this.finish(s).catch(() => this.end(s, 'feedback_error')), (this.durationSeconds - 90) * 1000),
      this.later(() => this.end(s, 'time_limit'), this.durationSeconds * 1000),
    ];
    this.respond(s, 'Comienza la bienvenida y recoge el perfil oral según las instrucciones.'); this.emit(s);
  }
  respond(s, instruction) {
    if (!s.connection || !['active', 'feedback'].includes(s.status)) return;
    s.pendingResponse = instruction || 'Continúa según las instrucciones y el resultado de las herramientas.';
    this.flushResponse(s);
  }
  flushResponse(s) {
    if (!s.pendingResponse || s.responding || s.speaking || s.status === 'ended' || s.processingTools) return;
    const instruction = s.pendingResponse; s.pendingResponse = null; s.responding = true;
    s.connection.send({ type: 'response.create', response: { instructions: instruction } });
  }
  userItem(s, id) {
    if (!id || s.userItems.has(id)) return;
    s.userItems.add(id); s.lastUserItem = id; s.answerVersion++;
  }
  addTranscript(s, id, role, text) {
    if (typeof text !== 'string' || !text.trim()) return;
    const item = { id, role, text: text.slice(0, 5000) };
    const index = s.transcript.findIndex(t => t.id === id);
    if (index >= 0) s.transcript[index] = item;
    else s.transcript.push(item);
    if (s.transcript.length > 150) { this.end(s, 'turn_limit'); return; }
    this.emit(s);
  }
  onEvent(s, event) {
    if (s.status === 'ended') return;
    switch (event.type) {
      case 'input_audio_buffer.speech_started': s.speaking = true; break;
      case 'input_audio_buffer.speech_stopped': s.speaking = false; break;
      case 'input_audio_buffer.committed': this.userItem(s, event.item_id); break;
      case 'conversation.item.input_audio_transcription.completed':
        this.userItem(s, event.item_id);
        this.addTranscript(s, event.item_id, 'user', event.transcript);
        this.respond(s); break;
      case 'conversation.item.input_audio_transcription.failed':
        this.userItem(s, event.item_id);
        this.respond(s, 'La transcripción no estuvo disponible. Escucha el audio; si no lo entendiste, pide repetir sin avanzar la entrevista.'); break;
      case 'response.output_audio_transcript.done': this.addTranscript(s, event.item_id, 'assistant', event.transcript); break;
      case 'response.created': s.responding = true; break;
      case 'response.done': {
        s.responding = false;
        const calls = (event.response?.output || []).filter(item => item.type === 'function_call');
        if (calls.length) {
          s.processingTools = true;
          s.queue = s.queue.then(async () => {
            for (const call of calls) {
              if (s.status === 'ended') return;
              if (s.calls.has(call.call_id)) continue;
              s.calls.add(call.call_id);
              let output;
              try { output = await this.tool(s, call.name, JSON.parse(call.arguments)); }
              catch { output = { error: 'No se pudo ejecutar. No inventes resultados. Pide repetir o terminar.' }; }
              s.connection?.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) } });
            }
          }).catch(() => {}).finally(() => { s.processingTools = false; this.respond(s); });
        } else this.flushResponse(s);
        break;
      }
      case 'error':
        // No registrar mensajes del proveedor que puedan contener datos personales.
        if (event.error?.code !== 'response_cancel_not_active') this.end(s, 'provider_error');
        break;
    }
  }
  plan(s) { return { nextPhase: phases[Math.min(3, Math.floor(s.principal / 2))], principal: s.principal, followUps: s.followUps, missing: profileFields.filter(key => !s.profile[key]) }; }
  recordAnswer(s) {
    const last = s.questions.at(-1);
    if (last && !last.answerId && s.answerVersion > s.consumedVersion) last.answerId = s.lastUserItem;
  }
  async tool(s, name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'Argumentos inválidos.' };
    if (name === 'get_feedback' && ['active', 'feedback'].includes(s.status)) {
      if (args.answeredCurrentQuestion === true) this.recordAnswer(s);
      const report = args.finish === true ? await this.finish(s) : await this.feedback(s);
      return { report, finished: s.status === 'feedback', ...this.plan(s), instruction: args.finish ? 'Lee spokenFeedback y despídete. No hagas más preguntas.' : 'Lee spokenFeedback brevemente y ofrece continuar con la pregunta pendiente.' };
    }
    if (s.status !== 'active') return { error: 'La entrevista está cerrando. Entrega solo el reporte disponible.', report: s.report || null };
    if (name === 'save_profile') {
      for (const key of [...profileFields, 'company']) {
        if (typeof args[key] === 'string' && args[key].trim()) s.profile[key] = args[key].trim().slice(0, 200);
      }
      this.emit(s); return this.plan(s);
    }
    if (name !== 'next_question') return { error: 'Herramienta desconocida.' };
    const plan = this.plan(s);
    if (plan.missing.length) return { ...plan, error: 'Primero recoge los campos de perfil que faltan por voz.' };
    if (s.questions.length && s.answerVersion <= s.consumedVersion) return { ...plan, error: 'Espera una respuesta del estudiante. No registres otra pregunta.', pendingQuestion: s.questions.at(-1).text };
    if (s.principal >= 8 && args.followUp !== true) { this.recordAnswer(s); return { report: await this.finish(s), finished: true }; }
    if (typeof args.question !== 'string' || args.question.trim().length < 8 || args.question.length > 700) return { ...plan, error: 'Escribe una sola pregunta breve y pertinente.' };
    const followUp = args.followUp === true;
    const expected = followUp ? s.questions.at(-1)?.phase : plan.nextPhase;
    if (args.phase !== expected || (followUp && (s.followUps >= 2 || !s.questions.length))) return { ...plan, error: 'Fase o límite de repreguntas inválido. Formula una principal en nextPhase.' };
    this.recordAnswer(s);
    s.questions.push({ text: args.question.trim(), phase: expected, followUp });
    if (followUp) s.followUps++; else s.principal++;
    s.consumedVersion = s.answerVersion;
    this.emit(s);
    return { question: args.question.trim(), phase: expected, ...this.plan(s), instruction: 'Pronuncia esta pregunta y espera respuesta. No llames otra herramienta en este turno.' };
  }
  async feedback(s) {
    if (s.feedbackPromise) return s.feedbackPromise;
    if (s.report && s.feedbackVersion === s.answerVersion) return s.report;
    s.feedbackVersion = s.answerVersion;
    s.feedbackAbort = new AbortController();
    const answered = s.questions.filter(q => q.answerId).length;
    const complete = s.questions.filter(q => !q.followUp && q.answerId).length === 8;
    s.feedbackPromise = (async () => {
      let report;
      try {
        report = await this.provider.feedback({ profile: s.profile, questions: s.questions,
          transcript: s.transcript, complete, answered }, s.feedbackAbort.signal);
      } catch {
        report = { summary: 'No se pudo generar una evaluación completa. No se asignó una valoración a tus respuestas.', strengths: [],
          improvements: ['Practica respuestas con un ejemplo concreto: situación, tarea, acción propia y resultado verificable.'],
          nextSteps: ['Vuelve a practicar para recibir una evaluación personalizada.'], spokenFeedback: 'No pude completar tu evaluación personalizada. Para tu siguiente práctica, estructura un ejemplo con situación, tarea, acción y resultado. No voy a atribuirte fortalezas o brechas sin evidencia.' };
      }
      if (s.status === 'ended') return null;
      s.report = { ...report, complete, answered, mainQuestionsAnswered: s.questions.filter(q => !q.followUp && q.answerId).length };
      this.emit(s); return s.report;
    })().finally(() => { s.feedbackPromise = null; });
    return s.feedbackPromise;
  }
  async finish(s) {
    if (s.status === 'ended') return s.report || null;
    if (!['active', 'feedback'].includes(s.status)) fail(409, 'INTERVIEW_NOT_READY', 'La entrevista todavía no está activa.');
    if (s.finishPromise) return s.finishPromise;
    if (s.status === 'feedback' && s.report) return s.report;
    s.status = 'feedback'; this.emit(s);
    s.finishPromise = (async () => {
      const report = await this.feedback(s);
      if (s.status !== 'ended') {
        // Aún queda tiempo para escuchar el resumen antes del límite duro.
        if (s.responding) s.connection?.send({ type: 'response.cancel' });
        s.connection?.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Entrevista finalizada. Lee en voz alta este reporte y despídete, sin más preguntas: ${JSON.stringify(report)}` }] } });
        this.respond(s, 'Lee el spokenFeedback del último reporte de sistema en menos de un minuto y despídete. No hagas más preguntas.');
        s.timers.push(this.later(() => this.end(s, 'completed'), 70000));
      }
      return report;
    })();
    return s.finishPromise;
  }
  async end(s, reason = 'user_closed') {
    if (s.status === 'ended') return;
    s.status = 'ended'; s.reason = reason; s.pendingResponse = null;
    for (const timer of [...s.timers, s.orphanTimer]) this.clearTimer(timer);
    s.feedbackAbort?.abort();
    this.emit(s);
    const connection = s.connection; s.connection = null;
    // El informe solo vive en la memoria de esta instancia durante cinco minutos.
    this.later(() => { s.transcript = []; s.profile = {}; s.questions = []; s.report = null; this.sessions.delete(s.id); }, 5 * 60 * 1000);
    if (connection) {
      try { await connection.close(); }
      catch {
        // Reintentar el hangup sin guardar ni registrar el contenido de la llamada.
        this.later(() => connection.close().catch(() => {}), 1000);
      }
    }
  }
  async shutdown() { await Promise.all([...this.sessions.values()].map(s => this.end(s, 'server_shutdown'))); }
}

module.exports = { InterviewService };
