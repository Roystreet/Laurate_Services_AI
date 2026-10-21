'use strict';

// Stop waiting even when a local extractor or DNS resolver cannot be cancelled.
function withSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      err => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

module.exports = { withSignal };
