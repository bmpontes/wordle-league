/* Cliente da API: gere o token CSRF e trata erros de forma uniforme. */
(function () {
  'use strict';

  let csrfToken = null;
  let sessionInfo = null;

  class ApiError extends Error {
    constructor(status, body) {
      const e = (body && body.error) || {};
      super(e.message || 'Erro de comunicação com o servidor.');
      this.status = status;
      this.code = e.code;
      this.details = e.details;
    }
  }

  async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      if (!csrfToken) await loadSession();
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-CSRF-Token'] = csrfToken;
      opts.body = JSON.stringify(body || {});
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw new ApiError(0, { error: { message: 'Sem ligação ao servidor.' } });
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      if (res.status === 403 && data && data.error && data.error.code === 'CSRF') csrfToken = null;
      throw new ApiError(res.status, data);
    }
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return data;
  }

  async function loadSession() {
    sessionInfo = await request('GET', '/api/auth/session');
    csrfToken = sessionInfo.csrfToken;
    return sessionInfo;
  }

  window.Api = {
    ApiError,
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    put: (url, body) => request('PUT', url, body),
    loadSession,
    session: () => sessionInfo,
  };
})();
