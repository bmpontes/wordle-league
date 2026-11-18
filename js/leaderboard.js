(function () {
  'use strict';
  const { el, clear } = UI;
  const body = document.getElementById('board-body');
  const alertEl = document.getElementById('board-alert');
  const caption = document.getElementById('board-caption');
  const dateInput = document.getElementById('board-date');
  const seasonSelect = document.getElementById('board-season');
  let current = 'daily';

  function renderRows(data) {
    clear(body);
    document.getElementById('col-extra').textContent = current === 'daily' ? 'Tentativas' : 'Jogos';
    if (!data.rows.length) {
      body.append(el('tr', {}, [el('td', { colspan: 7, class: 'muted', text: 'Ainda não há resultados neste período.' })]));
      return;
    }
    for (const r of data.rows) {
      const tr = el('tr', {}, [
        el('td', { class: `pos${r.position <= 3 ? ' p' + r.position : ''}`, text: r.position }),
        el('td', { text: r.displayName }),
        el('td', { class: 'num', text: r.points }),
        el('td', { class: 'num', text: r.wins }),
        el('td', { class: 'num', text: `${r.successRate}%` }),
        el('td', { class: 'num', text: r.bestStreak }),
        el('td', {
          class: 'num',
          text: current === 'daily' ? (r.status === 'won' ? r.attempts : '✗') : r.games,
        }),
      ]);
      if (r.isMe) tr.classList.add('me');
      body.append(tr);
    }
  }

  async function load() {
    UI.showAlert(alertEl);
    try {
      let data;
      if (current === 'daily') {
        data = await Api.get(`/api/leaderboard/daily${dateInput.value ? `?date=${encodeURIComponent(dateInput.value)}` : ''}`);
        caption.textContent = `Pontos obtidos no desafio de ${UI.formatDay(data.date)}. Desempate: menos tentativas e, depois, quem terminou primeiro.`;
      } else if (current === 'monthly') {
        data = await Api.get(`/api/leaderboard/monthly?season=${encodeURIComponent(seasonSelect.value)}`);
        caption.textContent = `Soma dos pontos em ${UI.formatMonth(data.season)} (reinicia no dia 1 de cada mês, hora de Portugal).`;
      } else {
        data = await Api.get('/api/leaderboard/alltime');
        caption.textContent = 'Soma de todos os pontos acumulados desde o início.';
      }
      renderRows(data);
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  }

  for (const tab of document.querySelectorAll('[data-board]')) {
    tab.addEventListener('click', () => {
      current = tab.dataset.board;
      for (const t of document.querySelectorAll('[data-board]')) t.setAttribute('aria-selected', String(t === tab));
      document.getElementById('filter-date').classList.toggle('hidden', current !== 'daily');
      document.getElementById('filter-season').classList.toggle('hidden', current !== 'monthly');
      load();
    });
  }
  dateInput.addEventListener('change', load);
  seasonSelect.addEventListener('change', load);

  UI.initPage()
    .then(async () => {
      const { current: cur, seasons } = await Api.get('/api/leaderboard/seasons');
      for (const s of seasons) seasonSelect.append(el('option', { value: s, text: UI.formatMonth(s), selected: s === cur }));
      const daily = await Api.get('/api/leaderboard/daily');
      dateInput.value = daily.date;
      dateInput.max = daily.date;
      load();
    })
    .catch((err) => err.message !== 'redirect' && UI.handleError(err, alertEl));
})();
