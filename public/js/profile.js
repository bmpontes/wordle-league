(function () {
  'use strict';
  const { el, clear } = UI;

  function stat(value, label) {
    return el('div', { class: 'stat' }, [el('div', { class: 'value', text: value }), el('div', { class: 'label', text: label })]);
  }

  function render(p) {
    document.getElementById('profile-title').textContent = `Perfil de ${p.user.displayName}`;
    const streakLabel = p.streakMode === 'participation' ? '(dias seguidos a jogar)' : '(dias seguidos com vitória)';
    const stats = clear(document.getElementById('stats'));
    stats.append(
      stat(p.games, 'Jogos'),
      stat(p.wins, 'Vitórias'),
      stat(`${p.winRate}%`, '% de vitórias'),
      stat(p.totalPoints, 'Pontuação total'),
      stat(p.currentStreak, `Streak atual ${streakLabel}`),
      stat(p.bestStreak, 'Melhor streak'),
      stat(p.bestMonthlyRank ? `${p.bestMonthlyRank.position}.º` : '—', p.bestMonthlyRank ? `Melhor mensal (${UI.formatMonth(p.bestMonthlyRank.season)})` : 'Melhor classificação mensal')
    );

    const dist = clear(document.getElementById('distribution'));
    const max = Math.max(1, ...p.distribution.map((d) => d.count));
    for (const d of p.distribution) {
      const bar = el('div', { class: 'dist-bar', text: d.count });
      bar.style.width = `${Math.max(8, (d.count / max) * 100)}%`;
      if (d.count === max && d.count > 0) bar.classList.add('hl');
      dist.append(el('div', { class: 'dist-row' }, [el('span', { class: 'n', text: d.attempts }), bar]));
    }

    const hist = clear(document.getElementById('history'));
    if (!p.history.length) hist.append(el('tr', {}, [el('td', { colspan: 5, class: 'muted', text: 'Ainda não concluiu nenhum desafio.' })]));
    for (const h of p.history) {
      hist.append(
        el('tr', {}, [
          el('td', { text: UI.formatDay(h.date) }),
          el('td', { class: 'mono', text: h.word }),
          el('td', {}, [el('span', { class: `badge ${h.status}`, text: UI.STATUS_LABELS[h.status] })]),
          el('td', { class: 'num', text: h.status === 'won' ? h.attempts : '✗' }),
          el('td', { class: 'num', text: h.bonus ? `${h.points} (+${h.bonus} bónus)` : h.points }),
        ])
      );
    }

    const ev = clear(document.getElementById('events'));
    if (!p.pointEvents.length) ev.append(el('tr', {}, [el('td', { colspan: 3, class: 'muted', text: 'Sem movimentos.' })]));
    for (const e of p.pointEvents) {
      ev.append(
        el('tr', {}, [
          el('td', { text: e.date ? UI.formatDay(e.date) : UI.formatDateTime(e.createdAt) }),
          el('td', { text: e.reason }),
          el('td', { class: 'num', text: e.points > 0 ? `+${e.points}` : e.points }),
        ])
      );
    }
  }

  document.getElementById('form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('pw-alert');
    try {
      await Api.post('/api/auth/password', {
        currentPassword: document.getElementById('pw-current').value,
        newPassword: document.getElementById('pw-new').value,
      });
      e.target.reset();
      UI.showAlert(alertEl, 'ok', 'Password alterada.');
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  });

  UI.initPage()
    .then(() => Api.get('/api/profile/me'))
    .then(render)
    .catch((err) => err.message !== 'redirect' && UI.handleError(err, document.getElementById('profile-alert')));
})();
