'use strict';

process.env.OPENAI_API_KEY = 'synthetic-test-key';
process.env.NODE_ENV = 'development';
process.env.PUBLIC_BASE_URL = '';
process.env.RATE_LIMIT_MAX = '500';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const JSZip = require('jszip');
const { openai } = require('../src/services/openai.client');
const publicDownload = require('../src/services/public-download.service');
const { extractHtml } = require('../src/services/proposal.service');
const { createMatchHandler } = require('../src/controllers/cv-match.controller');
const { errorHandler } = require('../src/middleware/errorHandler.middleware');
const app = require('../src/app');

const cvMarkdown = '# CV-STUDENT-7391\n\nDesarrollador Node.js con 4 años de experiencia en APIs REST, pruebas y SQL.';
const proposalText = 'PROPUESTA-7391. Buscamos desarrollador de Node.js con 3 años de experiencia, APIs REST y SQL. Las pruebas automatizadas son deseables.';
const html = `<html><head><title>Desarrollador de Node.js</title></head><body><nav>NO-INCLUIR-NAV</nav><main><h1>Desarrollador</h1><p>${proposalText}</p></main><footer>NO-INCLUIR-FOOTER</footer></body></html>`;
const compatible = {
  isCv: true, isJobProposal: true,
  requirements: [{ requirement: 'Experiencia en Node.js, indispensable.', mandatory: true, cvEvidence: 'Node.js', status: 'MET' }],
  recommendations: ['Destaca tus proyectos de APIs REST y su impacto con resultados verificables.'], missingInformation: [],
};
let server, base, pdf, docx, result, aiMode, fixture, lastDownloadUrl, lastMatchInput, matchCalls, formatCalls;

async function listen(application) {
  const s = application.listen(0, '127.0.0.1');
  await new Promise(resolve => s.once('listening', resolve));
  return s;
}

before(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 7; i++) page.drawText(`PROPUESTA-7391. Developer Node.js, REST, SQL. Tres anos de experiencia. Linea ${i}.`, { x: 30, y: 750 - i * 20, size: 11, font });
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${proposalText}</w:t></w:r></w:p></w:body></w:document>`);
  docx = await zip.generateAsync({ type: 'nodebuffer' });
  publicDownload.download = async (url, options) => {
    lastDownloadUrl = url;
    assert.ok(options.signal);
    assert.ok(options.maxBytes > 0);
    if (fixture instanceof Error) throw fixture;
    return { status: 200, headers: { 'content-type': 'text/html' }, url, ...fixture };
  };
  openai.chat.completions.create = async request => {
    if (!request.response_format) {
      formatCalls++;
      return { choices: [{ finish_reason: 'stop', message: { content: proposalText } }] };
    }
    matchCalls++;
    lastMatchInput = JSON.parse(request.messages[1].content);
    assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
    if (aiMode === 'error') throw new Error('Synthetic upstream failure');
    const content = aiMode === 'json' ? '{bad-json' : aiMode === 'empty' ? '' : JSON.stringify(result);
    return { choices: [{ finish_reason: aiMode === 'length' ? 'length' : 'stop',
      message: { content, refusal: aiMode === 'refusal' ? 'Synthetic refusal' : null } }] };
  };
  server = await listen(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });
beforeEach(() => {
  result = structuredClone(compatible);
  aiMode = 'normal';
  fixture = { buffer: Buffer.from(html) };
  lastDownloadUrl = lastMatchInput = undefined;
  matchCalls = formatCalls = 0;
});

async function match(body = { cvMarkdown, proposalUrl: 'https://jobs.example/vacante' }) {
  return fetch(`${base}/api/v1/cv-match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('CV upload → convert → public vacancy → typed verdict works without client credentials', async () => {
  const body = new FormData();
  body.append('file', new Blob([pdf], { type: 'application/pdf' }), 'cv.pdf');
  const uploaded = await (await fetch(`${base}/api/v1/documents`, { method: 'POST', body })).json();
  assert.equal(formatCalls, 0);
  const converted = await (await fetch(`${base}/api/v1/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: uploaded.url }) })).json();
  assert.equal(converted.source, 'document');
  const response = await match({ cvMarkdown: converted.markdown, proposalUrl: 'https://jobs.example/vacante' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const output = await response.json();
  assert.deepEqual(Object.keys(output).sort(), ['text', 'verdict']);
  assert.equal(output.verdict, 'COMPATIBLE');
  assert.match(output.text, /Fortalezas y coincidencias/);
  assert.match(output.text, /Recomendaciones para tu CV/);
  assert.ok(!lastMatchInput.propuesta.includes('NO-INCLUIR'));
});

test('incompatibility and insufficient information produce distinct evidence and advice', async () => {
  result = { ...compatible, requirements: [{ requirement: '8 años de experiencia, indispensable.', mandatory: true, cvEvidence: '4 años', status: 'NOT_MET' }] };
  let output = await (await match()).json();
  assert.equal(output.verdict, 'NO_COMPATIBLE');
  assert.match(output.text, /Brechas frente a la propuesta/);
  result = { ...compatible, requirements: [{ requirement: 'Certificación obligatoria.', mandatory: true, cvEvidence: null, status: 'UNKNOWN' }],
    missingInformation: ['El CV no indica si cuenta con la certificación obligatoria.'] };
  output = await (await match()).json();
  assert.equal(output.verdict, 'INFORMACION_INSUFICIENTE');
  assert.match(output.text, /Información pendiente/);
  assert.ok(!output.text.includes('%'));
});

test('missing or invented evidence cannot turn an unknown mandatory requirement into a failure or success', async () => {
  for (const status of ['NOT_MET', 'MET']) {
    for (const cvEvidence of [null, 'Certificado AWS inventado que no está en el CV']) {
      result = { ...compatible, requirements: [{ requirement: 'Certificación AWS indispensable.', mandatory: true, cvEvidence, status }] };
      const output = await (await match()).json();
      assert.equal(output.verdict, 'INFORMACION_INSUFICIENTE');
      assert.match(output.text, /No está demostrado en el CV/);
      assert.ok(!output.text.includes('No cumple según'));
    }
  }
});

test('a missing desirable skill does not outweigh a demonstrated match', async () => {
  result = { ...compatible, requirements: [...compatible.requirements,
    { requirement: 'AWS deseable.', mandatory: false, cvEvidence: null, status: 'UNKNOWN' }] };
  assert.equal((await (await match()).json()).verdict, 'COMPATIBLE');
});

test('unrecognizable CVs and non-vacancy pages yield insufficient information', async () => {
  for (const key of ['isCv', 'isJobProposal']) {
    result = { ...compatible, [key]: false, missingInformation: [] };
    const output = await (await match()).json();
    assert.equal(output.verdict, 'INFORMACION_INSUFICIENTE');
    assert.match(output.text, /Información pendiente/);
  }
});

test('PDF, DOCX and image proposals use the same conversion pipeline as CVs', async () => {
  for (const [name, buffer, type] of [
    ['propuesta.pdf', pdf, 'application/pdf'],
    ['propuesta.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['propuesta.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==', 'base64'), 'image/png'],
  ]) {
    fixture = { buffer, headers: { 'content-type': type } };
    const response = await match({ cvMarkdown, proposalUrl: `https://files.example/${name}` });
    assert.equal(response.status, 200);
    assert.equal(lastMatchInput.propuesta, proposalText);
  }
  assert.equal(formatCalls, 3);
});

test('Google Docs, Drive and Dropbox links retain direct-download rewriting', async () => {
  fixture = { buffer: pdf, headers: { 'content-type': 'application/pdf' } };
  for (const [url, expected] of [
    ['https://docs.google.com/document/d/public/edit', 'https://docs.google.com/document/d/public/export?format=docx'],
    ['https://drive.google.com/file/d/public/view', 'https://drive.google.com/uc?export=download&id=public'],
    ['https://www.dropbox.com/s/public/propuesta.pdf?dl=0', 'https://www.dropbox.com/s/public/propuesta.pdf?dl=1'],
  ]) {
    assert.equal((await match({ cvMarkdown, proposalUrl: url })).status, 200);
    assert.equal(lastDownloadUrl, expected);
  }
});

test('a shared document sign-in page is not evaluated as a vacancy', async () => {
  const response = await match({ cvMarkdown, proposalUrl: 'https://docs.google.com/document/d/private/edit' });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'PROPOSAL_UNAVAILABLE');
  assert.equal(matchCalls, 0);
});

test('token-protected proposal documents resolve in memory and expired ones ask for a new link', async () => {
  const body = new FormData();
  body.append('file', new Blob([pdf], { type: 'application/pdf' }), 'propuesta.pdf');
  const staged = await (await fetch(`${base}/api/v1/documents`, { method: 'POST', body })).json();
  assert.equal((await match({ cvMarkdown, proposalUrl: staged.url })).status, 200);
  assert.equal(lastDownloadUrl, undefined);
  const expired = `${base}/api/v1/documents/${'0'.repeat(32)}?token=expired`;
  const response = await match({ cvMarkdown, proposalUrl: expired });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'DOCUMENT_NOT_FOUND');
});

test('JobPosting JSON-LD is preferred, including graphs and requirement metadata', () => {
  const job = { '@graph': [{ '@type': 'JobPosting', title: 'Developer', description: `<p>${proposalText}</p>`, skills: 'TypeScript',
    experienceRequirements: { monthsOfExperience: 36 } }] };
  const output = extractHtml(Buffer.from(`<html><head><script type="application/ld+json">${JSON.stringify(job)}</script></head><body><main>${'irrelevante '.repeat(10000)}</main></body></html>`));
  assert.match(output, /PROPUESTA-7391/);
  assert.match(output, /TypeScript/);
  assert.match(output, /monthsOfExperience/);
  assert.ok(!output.includes('irrelevante'));
});

test('HTML fallback preserves paragraphs and removes scripts, forms and hidden content', () => {
  const output = extractHtml(Buffer.from(`<html><body><article><h1>Oferta</h1><p>${proposalText}</p><ul><li>Primera función</li><li>Segunda función</li></ul><script>NO-SCRIPT</script><form>NO-FORM</form><div hidden>NO-HIDDEN</div></article></body></html>`));
  assert.match(output, /Primera función\nSegunda función/);
  assert.ok(!output.includes('NO-'));
});

test('HTTP and HTML charset declarations preserve accented proposal text', () => {
  const latin1 = Buffer.from(`<html><body><main>${proposalText}</main></body></html>`, 'latin1');
  assert.ok(extractHtml(latin1, 'text/html; charset=iso-8859-1').includes('años'));
  const declared = Buffer.from(`<html><head><meta charset="iso-8859-1"></head><body><main>${proposalText}</main></body></html>`, 'latin1');
  assert.ok(extractHtml(declared).includes('años'));
});

test('multiple vacancies, JS shells, login pages and oversized proposal text are rejected before matching', async () => {
  for (const [page, code, status] of [
    ['<html><head><title>Sign in</title></head><body>' + proposalText + '</body></html>', 'PROPOSAL_UNREADABLE', 422],
    ['<html><body><div id="app"></div></body></html>', 'PROPOSAL_UNREADABLE', 422],
    [`<script type="application/ld+json">${JSON.stringify([{ '@type': 'JobPosting' }, { '@type': 'JobPosting' }])}</script>`, 'MULTIPLE_PROPOSALS', 422],
    ['<main>' + 'x'.repeat(80001) + '</main>', 'CONTENT_TOO_LONG', 413],
  ]) {
    fixture = { buffer: Buffer.from(page) };
    const response = await match();
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  assert.equal(matchCalls, 0);
});

test('invalid request types, empty inputs, credentials and protocols are rejected', async () => {
  for (const body of [{}, { cvMarkdown: '', proposalUrl: 'https://example.com' }, { cvMarkdown: [], proposalUrl: 'https://example.com' },
    { cvMarkdown, proposalUrl: [] }, { cvMarkdown, proposalUrl: 'not a URL' }, { cvMarkdown, proposalUrl: 'file:///etc/passwd' },
    { cvMarkdown, proposalUrl: 'https://user:password@example.com/job' }]) {
    assert.equal((await match(body)).status, 400);
  }
  assert.equal(matchCalls, 0);
});

test('80,000 CV characters fit the route-specific JSON limit; larger CVs are not truncated', async () => {
  const exact = 'é'.repeat(80000);
  assert.equal((await match({ cvMarkdown: exact, proposalUrl: 'https://example.com/job' })).status, 200);
  assert.equal(lastMatchInput.cv, exact);
  const response = await match({ cvMarkdown: exact + 'x', proposalUrl: 'https://example.com/job' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'CONTENT_TOO_LONG');
  assert.equal(matchCalls, 1);
});

test('malformed and oversized JSON produce the documented error envelope', async () => {
  const malformed = await fetch(`${base}/api/v1/cv-match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const response = await match({ cvMarkdown: 'x'.repeat(513 * 1024), proposalUrl: 'https://example.com/job' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
});

test('invalid, refused, incomplete and empty AI responses never become a successful verdict', async () => {
  for (const mode of ['json', 'refusal', 'length', 'empty']) {
    aiMode = mode;
    const response = await match();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_AI_RESPONSE');
  }
  aiMode = 'normal';
  for (const invalid of [{ ...compatible, isCv: 'true' }, { ...compatible, requirements: 'not a list' },
    { ...compatible, requirements: [{ ...compatible.requirements[0], status: 'MAYBE' }] }, { ...compatible, extra: true }, { ...compatible, recommendations: [] }]) {
    result = invalid;
    assert.equal((await match()).status, 502);
  }
});

test('failed attempts can be retried, and a new request uses its own CV and proposal', async () => {
  aiMode = 'error';
  const failed = await match();
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error.code, 'UPSTREAM_AI_ERROR');
  aiMode = 'normal';
  assert.equal((await match()).status, 200);
  const otherCv = 'OTRO-CV: Analista con experiencia en datos.';
  fixture = { buffer: Buffer.from(`<main>OTRA-PROPUESTA: ${proposalText}</main>`) };
  result = { ...compatible, recommendations: ['Recomendación de la segunda solicitud.'] };
  const output = await (await match({ cvMarkdown: otherCv, proposalUrl: 'https://example.com/other' })).json();
  assert.equal(lastMatchInput.cv, otherCv);
  assert.match(lastMatchInput.propuesta, /OTRA-PROPUESTA/);
  assert.match(output.text, /segunda solicitud/);
});

test('the total deadline returns 504 and aborts ongoing work', async () => {
  let observedSignal;
  const deadlineApp = express();
  deadlineApp.use(express.json());
  deadlineApp.post('/match', createMatchHandler({ timeoutMs: 20, extractProposal: async (_url, { signal }) => {
    observedSignal = signal;
    return new Promise(() => {});
  }, compare: () => { throw new Error('Must not compare'); } }));
  deadlineApp.use(errorHandler);
  const s = await listen(deadlineApp);
  try {
    const response = await fetch(`http://127.0.0.1:${s.address().port}/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cvMarkdown, proposalUrl: 'https://example.com/job' }) });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'MATCH_TIMEOUT');
    assert.equal(observedSignal.aborted, true);
  } finally { s.closeAllConnections(); s.close(); }
});

test('OpenAPI exposes the complete matching contract', async () => {
  const spec = await (await fetch(`${base}/docs.json`)).json();
  assert.ok(spec.paths['/api/v1/cv-match'].post.responses['504']);
  assert.equal(spec.components.schemas.CvMatchRequest.properties.cvMarkdown.maxLength, 80000);
  assert.deepEqual(spec.components.schemas.CvMatchResponse.properties.verdict.enum, ['COMPATIBLE', 'NO_COMPATIBLE', 'INFORMACION_INSUFICIENTE']);
});
