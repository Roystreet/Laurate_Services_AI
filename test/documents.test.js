'use strict';

process.env.OPENAI_API_KEY = 'synthetic-test-key';
process.env.API_KEY = 'synthetic-service-key';
process.env.NODE_ENV = 'development';
process.env.MAX_FILE_SIZE_MB = '1';
process.env.DOCUMENT_UPLOAD_MAX_MB = '1';
process.env.DOCUMENT_UPLOAD_ORIGINS = 'http://localhost:8082';
process.env.PUBLIC_BASE_URL = '';
process.env.RATE_LIMIT_MAX = '100';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createDocumentStore } = require('../src/services/document-store.service');
const { openai } = require('../src/services/openai.client');
const app = require('../src/app');

let server, fixtureServer, base, fixtureUrl, pdf, staged;
let failAi = false;
let aiCalls = 0;
const auth = { 'x-api-key': process.env.API_KEY };
const origin = { Origin: 'http://localhost:8082' };

before(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 7; i++) page.drawText(`LAURATE-TEST-7391. Linea ${i}. Documento sintetico sin datos personales.`, { x: 40, y: 700 - i * 20, size: 12, font });
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
  openai.chat.completions.create = async request => {
    aiCalls++;
    if (failAi) throw new Error('Synthetic upstream error');
    assert.ok(request.messages.some(message => typeof message.content === 'string' && message.content.includes('LAURATE-TEST-7391')));
    return { choices: [{ message: { content: '# CV\n\nLAURATE-TEST-7391' } }], usage: { total_tokens: 10 } };
  };
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  fixtureServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); }).listen(0, '127.0.0.1');
  await new Promise(resolve => fixtureServer.once('listening', resolve));
  fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/cv.pdf`;
});

after(() => { for (const s of [server, fixtureServer]) { s.closeAllConnections(); s.close(); } });

function form(buffer = pdf, filename = 'cv.pdf', type = 'application/pdf') {
  const body = new FormData();
  body.append('file', new Blob([buffer], { type }), filename);
  return body;
}
async function convert(url) {
  return fetch(base + '/api/v1/convert', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
}

test('upload stages an original file without calling AI or requiring the converter key', async () => {
  const previous = aiCalls;
  const response = await fetch(base + '/api/v1/documents', { method: 'POST', headers: origin, body: form() });
  assert.equal(response.status, 201);
  staged = await response.json();
  assert.equal(staged.source, 'document');
  assert.equal(staged.filename, 'cv.pdf');
  assert.ok(new URL(staged.url).searchParams.get('token'));
  assert.ok(Date.parse(staged.expiresAt) > Date.now());
  assert.equal(aiCalls, previous);
});

test('download requires a valid capability token and returns the identical bytes', async () => {
  const response = await fetch(staged.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const bad = new URL(staged.url); bad.searchParams.set('token', 'invalid');
  assert.equal((await fetch(bad)).status, 404);
  bad.search = '';
  assert.equal((await fetch(bad)).status, 404);
});

test('staged file → converter preserves document source and parses pooled PDF buffers', async () => {
  const response = await convert(staged.url);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, 'document');
  assert.equal(result.filename, 'cv.pdf');
  assert.equal(result.meta.strategy, 'local-pdf-parse+gpt');
  assert.match(result.markdown, /LAURATE-TEST-7391/);
});

test('ordinary URL → converter identifies link source', async () => {
  const response = await convert(fixtureUrl);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, 'link');
  assert.match(result.markdown, /LAURATE-TEST-7391/);
});

test('existing authenticated multipart contract still identifies a document', async () => {
  const response = await fetch(base + '/api/v1/convert', { method: 'POST', headers: auth, body: form() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, 'document');
});

test('converter authentication is required even for a staged URL', async () => {
  const response = await fetch(base + '/api/v1/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: staged.url }) });
  assert.equal(response.status, 401);
});

test('upload rejects absent/disallowed Origin, forged file types, oversize and multiple files', async () => {
  for (const headers of [{}, { Origin: 'https://unrelated.example' }]) {
    assert.equal((await fetch(base + '/api/v1/documents', { method: 'POST', headers, body: form() })).status, 403);
  }
  assert.equal((await fetch(base + '/api/v1/documents', { method: 'POST', headers: origin, body: form(Buffer.from('not pdf')) })).status, 400);
  assert.equal((await fetch(base + '/api/v1/documents', { method: 'POST', headers: origin, body: form(Buffer.alloc(1024 * 1024 + 1)) })).status, 413);
  const multiple = form(); multiple.append('file', new Blob([pdf], { type: 'application/pdf' }), 'cv2.pdf');
  assert.equal((await fetch(base + '/api/v1/documents', { method: 'POST', headers: origin, body: multiple })).status, 400);
});

test('store expires documents and frees capacity, rejecting tokens that are not strings', () => {
  let now = 1000;
  const store = createDocumentStore({ ttlSeconds: 1, maxBytes: 4, now: () => now });
  const file = { buffer: Buffer.from('test'), mimetype: 'application/pdf', originalname: '../cv.pdf' };
  try {
    const document = store.put(file);
    assert.equal(document.originalname, 'cv.pdf');
    assert.throws(() => store.put(file), { code: 'DOCUMENT_STORE_FULL' });
    assert.throws(() => store.get(document.id, [document.token]), { code: 'DOCUMENT_NOT_FOUND' });
    assert.throws(() => store.get(document.id, 'é'.repeat(64)), { code: 'DOCUMENT_NOT_FOUND' });
    now = 2001;
    assert.throws(() => store.get(document.id, document.token), { code: 'DOCUMENT_NOT_FOUND' });
    assert.ok(store.put(file).id);
  } finally { store.close(); }
});

test('upstream errors have a structured response and allow retrying the staged URL', async () => {
  failAi = true;
  const response = await convert(staged.url);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'UPSTREAM_AI_ERROR');
  failAi = false;
  assert.equal((await convert(staged.url)).status, 200);
});

test('OpenAPI includes document routes and conversion source', async () => {
  const spec = await (await fetch(base + '/docs.json')).json();
  assert.ok(spec.paths['/api/v1/documents']);
  assert.deepEqual(spec.components.schemas.ConvertResponse.properties.source.enum, ['document', 'link']);
});
