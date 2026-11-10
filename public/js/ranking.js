/* Classificação pública do mês em curso (sem autenticação). Atualiza-se automaticamente. */
(function () {
  'use strict';
  const { el, clear } = UI;
  const REFRESH_MS = 60 * 1000;
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const alertEl = document.getElementById('alert');

  function daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  }

  function render(data) {
    document.getElementById('season').textContent = UI.formatMonth(data.season);
    const left = daysBetween(data.today, data.endsOn);
    document.getElementById('days-left').textContent =
      left <= 0 ? 'Último dia do mês' : `Termina em ${left + 1} dias · reinicia no dia 1`;

    clear(list);
    empty.classList.toggle('hidden', data.rows.length > 0);
    data.rows.forEach((r) => {
      const stats = `${r.wins} vitória${r.wins === 1 ? '' : 's'} · ${r.successRate}% · streak ${r.bestStreak}`;
      const li = el('li', { class: `rk-row${r.position === 1 ? ' top1' : ''}` }, [
        el('span', { class: 'rk-rank', text: `${r.position}.º` }),
        el('span', { class: 'rk-bar', text: '|', 'aria-hidden': 'true' }),
        el('span', { class: 'rk-name' }, [
          el('span', { class: 'rk-name-main' }, [
            el('span', { class: 'rk-name-text', text: r.displayName }),
            r.position === 1 ? el('span', { class: 'rk-tag', text: 'Líder do mês' }) : null,
          ]),
          el('small', { text: stats }),
        ]),
        el('span', { class: 'rk-bar', text: '|', 'aria-hidden': 'true' }),
        el('span', { class: 'rk-points' }, [String(r.points), el('span', { text: 'PTS' })]),
      ]);
      list.append(li);
    });
  }

  async function load() {
    try {
      const data = await Api.get('/api/public/leaderboard');
      alertEl.classList.add('hidden');
      render(data);
      document.getElementById('updated').textContent =
        `Atualizado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      clear(list);
      empty.classList.add('hidden');
      alertEl.textContent = err.message;
      alertEl.classList.remove('hidden');
    }
  }

  // Lado direito: imagem do ranking (se definida no painel) ou o logótipo.
  UI.brandReady.then((b) => {
    const art = document.getElementById('rk-art');
    if (b && b.rankingUrl) {
      art.style.backgroundImage = `url("${b.rankingUrl}")`;
    } else {
      art.classList.add('logo-mode');
      art.append(el('img', { src: b ? b.logoUrl : '/brand/logo', alt: '', class: b && b.logoRound ? 'round' : null }));
    }
  });

  load();
  setInterval(load, REFRESH_MS);
})();
