'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const zlib = require('node:zlib');
const { createPublicDownloader, requestOnce, isPublicAddress } = require('../src/services/public-download.service');

const publicEntry = { address: '93.184.215.14', family: 4 };
const good = { status: 200, headers: {}, buffer: Buffer.from('proposal') };
const options = { maxBytes: 1000 };

test('only public unicast addresses are accepted, including IPv4-mapped IPv6', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress(publicEntry.address), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('literal private IPs, local names and mixed DNS answers never reach the transport', async () => {
  let calls = 0;
  const download = createPublicDownloader({ lookup: async () => [publicEntry, { address: '10.0.0.2', family: 4 }], request: async () => { calls++; return good; } });
  for (const url of ['http://127.0.0.1/job', 'http://[::1]/job', 'http://2130706433/job', 'http://localhost/job', 'http://host.local/job', 'https://jobs.example/job']) {
    await assert.rejects(download(url, options), { code: 'UNSAFE_URL' });
  }
  assert.equal(calls, 0);
});

test('redirects are revalidated and cannot target private networks or unsafe protocols', async () => {
  for (const location of ['http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'http://private.example/job']) {
    const calls = [];
    const download = createPublicDownloader({ lookup: async host => host === 'private.example' ? [{ address: '192.168.1.1', family: 4 }] : [publicEntry],
      request: async url => { calls.push(url.href); return { status: 302, headers: { location } }; } });
    await assert.rejects(download('https://jobs.example/job', options), err => ['UNSAFE_URL', 'INVALID_URL'].includes(err.code));
    assert.equal(calls.length, 1);
  }
});

test('relative public redirects work and repeated redirects stop after five hops', async () => {
  const visited = [];
  const download = createPublicDownloader({ lookup: async () => [publicEntry], request: async url => {
    visited.push(url.pathname);
    return url.pathname === '/first' ? { status: 302, headers: { location: '/final' } } : good;
  } });
  assert.equal((await download('https://jobs.example/first', options)).url, 'https://jobs.example/final');
  assert.deepEqual(visited, ['/first', '/final']);
  let hops = 0;
  const looping = createPublicDownloader({ lookup: async () => [publicEntry], request: async () => { hops++; return { status: 301, headers: { location: '/loop' } }; } });
  await assert.rejects(looping('https://jobs.example/loop', options), { code: 'DOWNLOAD_FAILED' });
  assert.equal(hops, 6);
});

test('access failures and empty files produce actionable download errors', async () => {
  for (const [response, code] of [[{ status: 403, headers: {} }, 'PROPOSAL_UNAVAILABLE'], [{ ...good, buffer: Buffer.alloc(0) }, 'PROPOSAL_UNREADABLE']]) {
    const download = createPublicDownloader({ lookup: async () => [publicEntry], request: async () => response });
    await assert.rejects(download('https://jobs.example/job', options), { code });
  }
});

test('the download deadline also bounds DNS resolution and accepts caller cancellation', async () => {
  const download = createPublicDownloader({ timeoutMs: 15, lookup: async () => new Promise(() => {}), request: async () => good });
  await assert.rejects(download('https://jobs.example/job', options), { code: 'PROPOSAL_DOWNLOAD_TIMEOUT' });
  const controller = new AbortController();
  controller.abort(new Error('Caller cancelled'));
  await assert.rejects(download('https://jobs.example/job', { ...options, signal: controller.signal }), /Caller cancelled/);
});

function transport({ chunks, headers = {}, inspect = () => {} }) {
  return (url, requestOptions, callback) => {
    const req = new EventEmitter();
    inspect(url, requestOptions);
    queueMicrotask(() => {
      const response = Readable.from(chunks);
      response.statusCode = 200;
      response.headers = headers;
      callback(response);
    });
    return req;
  };
}

test('connections pin the validated address while retaining the original HTTPS hostname', async () => {
  const response = await requestOnce(new URL('https://jobs.example/job'), { addresses: [publicEntry], maxBytes: 1000,
    requestImpl: transport({ chunks: [Buffer.from('hello')], inspect: (url, opts) => {
      assert.equal(url.hostname, 'jobs.example');
      assert.equal(opts.agent, false);
      opts.lookup('jobs.example', {}, (err, address, family) => {
        assert.equal(err, null); assert.equal(address, publicEntry.address); assert.equal(family, 4);
      });
      opts.lookup('jobs.example', { all: true }, (err, entries) => {
        assert.equal(err, null); assert.deepEqual(entries, [publicEntry]);
      });
    } }) });
  assert.equal(response.buffer.toString(), 'hello');
});

test('streamed, declared and decompressed bodies enforce the byte limit', async () => {
  for (const fixture of [
    { chunks: [Buffer.alloc(600), Buffer.alloc(600)] },
    { chunks: [], headers: { 'content-length': '1001' } },
    { chunks: [zlib.gzipSync(Buffer.alloc(2000))], headers: { 'content-encoding': 'gzip' } },
  ]) {
    await assert.rejects(requestOnce(new URL('https://jobs.example/job'), { addresses: [publicEntry], maxBytes: 1000, requestImpl: transport(fixture) }), { code: 'FILE_TOO_LARGE' });
  }
});

test('compressed HTML is decoded before extraction', async () => {
  const original = Buffer.from('<main>Propuesta laboral</main>');
  for (const [encoding, encode] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
    const response = await requestOnce(new URL('https://jobs.example/job'), { addresses: [publicEntry], maxBytes: 1000,
      requestImpl: transport({ chunks: [encode(original)], headers: { 'content-encoding': encoding } }) });
    assert.deepEqual(response.buffer, original);
  }
});
