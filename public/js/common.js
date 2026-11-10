/* Utilitários comuns da interface. Todo o texto dinâmico usa textContent (sem innerHTML). */
(function () {
  'use strict';

  /** Cria um elemento: el('div', { class: 'x', text: '...' }, [filhos]) */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function toast(message, ms = 1800) {
    let zone = document.querySelector('.toast-zone');
    if (!zone) {
      zone = el('div', { class: 'toast-zone', role: 'status', 'aria-live': 'polite' });
      document.body.append(zone);
    }
    const t = el('div', { class: 'toast', text: message });
    zone.append(t);
    setTimeout(() => t.remove(), ms);
  }

  function showAlert(container, type, message) {
    clear(container);
    if (message) container.append(el('div', { class: `alert ${type}`, role: type === 'error' ? 'alert' : 'status', text: message }));
  }

  const dateFmt = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  /** "2026-10-19" → "19/10/2026" (sem conversões de fuso). */
  function formatDay(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  const formatDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
  const formatMonth = (code) => {
    const [y, m] = code.split('-').map(Number);
    const name = new Intl.DateTimeFormat('pt-PT', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
  };

  const STATUS_LABELS = { won: 'Vitória', lost: 'Derrota', expired: 'Não concluído', in_progress: 'Em curso', not_started: 'Por jogar' };

  function applyColorblindPreference() {
    let on = false;
    try { on = localStorage.getItem('fwl.colorblind') === '1'; } catch { /* ignorar */ }
    document.documentElement.classList.toggle('cb', on);
    return on;
  }

  function toggleColorblind() {
    const on = !document.documentElement.classList.contains('cb');
    document.documentElement.classList.toggle('cb', on);
    try { localStorage.setItem('fwl.colorblind', on ? '1' : '0'); } catch { /* ignorar */ }
    return on;
  }

  /** Prepara o cabeçalho e garante sessão. Redireciona para /login se necessário. */
  async function initPage({ requireAuth = true, requireAdmin = false } = {}) {
    applyColorblindPreference();
    let session;
    try {
      session = await Api.loadSession();
    } catch (err) {
      document.body.prepend(el('div', { class: 'alert error', text: err.message }));
      throw err;
    }
    if (requireAuth && !session.user) {
      location.replace('/login');
      throw new Error('redirect');
    }
    if (requireAdmin && session.user.role !== 'admin') {
      location.replace('/');
      throw new Error('redirect');
    }

    const nav = document.querySelector('.nav');
    const brand = document.querySelector('a.brand');
    if (brand && session.user && session.user.role === 'admin') brand.setAttribute('href', '/admin');
    if (nav && session.user) {
      for (const a of nav.querySelectorAll('a')) {
        if (a.getAttribute('href') === location.pathname) a.setAttribute('aria-current', 'page');
        if (a.dataset.admin !== undefined && session.user.role !== 'admin') a.remove();
        if (a.dataset.player !== undefined && session.user.role === 'admin') a.remove();
      }
      const cb = el('button', { type: 'button', title: 'Alternar cores para daltonismo', 'aria-pressed': String(document.documentElement.classList.contains('cb')), text: '◐' });
      cb.addEventListener('click', () => cb.setAttribute('aria-pressed', String(toggleColorblind())));
      const out = el('button', { type: 'button', text: 'Sair' });
      out.addEventListener('click', async () => {
        try { await Api.post('/api/auth/logout'); } finally { location.replace('/login'); }
      });
      nav.append(cb, out);
    }
    return session;
  }

  /** Mostra o erro de uma chamada; 401 → login. */
  function handleError(err, container) {
    if (err && err.status === 401) {
      location.replace('/login');
      return;
    }
    if (container) showAlert(container, 'error', err.message);
    else toast(err.message, 3000);
  }

  window.UI = {
    el, clear, toast, showAlert, initPage, handleError,
    formatDay, formatDateTime, formatMonth, STATUS_LABELS,
    applyColorblindPreference, toggleColorblind,
  };
})();
