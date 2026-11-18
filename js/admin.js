(function () {
  'use strict';
  const { el, clear, showAlert } = UI;
  const mainAlert = document.getElementById('admin-alert');
  let me = null;

  const LIST_LABELS = { secret: 'Palavras secretas', accepted: 'Palavras aceites' };
  const LIST_HELP = {
    secret: 'Lista de onde é escolhida a palavra de cada dia. Cada palavra é usada uma vez até a lista se esgotar.',
    accepted: 'Lista de validação: palavras que podem ser usadas nas tentativas. As palavras secretas são sempre aceites.',
  };

  const fail = (container) => (err) => UI.handleError(err, container || mainAlert);
  const emptyRow = (cols, text) => el('tr', {}, [el('td', { colspan: cols, class: 'muted', text })]);

  // ---------- Navegação por secções ----------
  const loaders = {};
  function show(section) {
    for (const t of document.querySelectorAll('[data-section]')) t.setAttribute('aria-selected', String(t.dataset.section === section));
    for (const p of document.querySelectorAll('[data-panel]')) p.classList.toggle('hidden', p.id !== `section-${section}`);
    showAlert(mainAlert);
    if (loaders[section]) loaders[section]().catch(fail());
  }
  for (const t of document.querySelectorAll('[data-section]')) t.addEventListener('click', () => show(t.dataset.section));

  const stat = (value, label) => el('div', { class: 'stat' }, [el('div', { class: 'value', text: value }), el('div', { class: 'label', text: label })]);

  // ---------- Estado ----------
  loaders.status = async () => {
    const s = await Api.get('/api/admin/status');
    const w = clear(document.getElementById('status-warnings'));
    for (const msg of s.warnings) w.append(el('div', { class: 'alert warn', text: msg }));
    if (!s.warnings.length) w.append(el('div', { class: 'alert ok', text: 'Sem avisos. A aplicação está operacional.' }));
    clear(document.getElementById('status-stats')).append(
      stat(UI.formatDay(s.today), 'Data do desafio (Lisboa)'),
      stat(s.todayChallenge.exists ? 'Sim' : 'Não', 'Desafio de hoje criado'),
      stat(s.todayChallenge.exists ? s.todayChallenge.players : 0, 'Jogadores hoje'),
      stat(s.lists.secret, 'Palavras secretas'),
      stat(s.wordPool.unused, 'Secretas por usar'),
      stat(s.lists.accepted, 'Palavras aceites')
    );
    document.getElementById('status-meta').textContent =
      `Hora da base de dados: ${UI.formatDateTime(s.serverTime)} · Fuso: ${s.timezone} · Tamanho: ${s.dbSizeBytes ? (s.dbSizeBytes / 1048576).toFixed(1) + ' MB (limite gratuito: 500 MB)' : '—'} · PostgreSQL ${s.dbVersion}`;
  };

  // ---------- Palavras ----------
  function wordListCard(type, info) {
    const resultBox = el('div');
    const fileInput = el('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', id: `file-${type}` });
    const previewBtn = el('button', { type: 'button', class: 'btn', text: 'Analisar ficheiro' });

    previewBtn.addEventListener('click', async () => {
      clear(resultBox);
      const file = fileInput.files[0];
      if (!file) return showAlert(resultBox, 'error', 'Escolha um ficheiro .txt ou .csv.');
      if (file.size > 5 * 1024 * 1024) return showAlert(resultBox, 'error', 'Ficheiro demasiado grande (máximo 5 MB).');
      previewBtn.disabled = true;
      try {
        const content = await file.text();
        const p = await Api.post('/api/admin/words/preview', { listType: type, filename: file.name, content });
        renderPreview(resultBox, p);
      } catch (err) {
        UI.handleError(err, resultBox);
      } finally {
        previewBtn.disabled = false;
      }
    });

    const byLength = info.byLength.map((b) => `${b.n} × ${b.length} letras`).join(', ') || 'vazia';
    return el('div', { class: 'card' }, [
      el('h2', { text: LIST_LABELS[type] }),
      el('p', { class: 'muted', text: LIST_HELP[type] }),
      el('p', {}, [el('strong', { text: `${info.total} palavras` }), ` (${byLength})`]),
      el('p', {}, [el('button', { type: 'button', class: 'btn small', text: 'Exportar lista atual (.txt)', onclick: () => Api.exportWords(type).catch(fail()) })]),
      el('div', { class: 'field' }, [el('label', { for: `file-${type}`, text: 'Importar ficheiro (UTF-8, uma palavra por linha ou CSV com coluna "palavra")' }), fileInput]),
      previewBtn,
      resultBox,
    ]);
  }

  function renderPreview(box, p) {
    clear(box);
    const summary = el('div', { class: 'alert info' }, [
      el('strong', { text: 'Resumo da análise' }),
      el('br'),
      `Formato: ${p.format.toUpperCase()} · Tamanho exigido: ${p.wordLength} letras`,
      el('br'),
      `Válidas: ${p.validCount} · Inválidas: ${p.invalidCount} · Duplicadas no ficheiro: ${p.duplicateCount} · Linhas vazias/comentários: ${p.emptyLines}`,
      el('br'),
      `Já existentes na lista atual: ${p.alreadyInList} · Lista atual: ${p.currentCount} palavras`,
    ]);
    box.append(summary);
    if (p.sampleValid.length) box.append(el('p', { class: 'muted', text: `Amostra de válidas (${Math.min(p.sampleValid.length, p.validCount)}):` }), el('div', { class: 'words-sample', text: p.sampleValid.join(', ') }));
    if (p.sampleInvalid.length) {
      box.append(
        el('p', { class: 'muted', text: 'Entradas inválidas (amostra):' }),
        el('div', { class: 'words-sample', text: p.sampleInvalid.map((i) => `linha ${i.line}: "${i.value}" — ${i.reason}`).join('\n') })
      );
    }
    if (p.sampleDuplicates.length) {
      box.append(el('p', { class: 'muted', text: 'Duplicados ignorados (amostra):' }), el('div', { class: 'words-sample', text: p.sampleDuplicates.map((d) => `linha ${d.line}: ${d.value}`).join('\n') }));
    }
    if (!p.validCount) {
      box.append(el('div', { class: 'alert error', text: 'O ficheiro não contém palavras válidas. Nada será importado.' }));
      return;
    }

    const name = `mode-${p.listType}`;
    const append = el('input', { type: 'radio', name, value: 'append', checked: true });
    const replace = el('input', { type: 'radio', name, value: 'replace' });
    const confirmBox = el('input', { type: 'checkbox' });
    const confirmLabel = el('label', { class: 'check hidden' }, [confirmBox, ` Confirmo que quero substituir as ${p.currentCount} palavras existentes.`]);
    const toggle = () => confirmLabel.classList.toggle('hidden', !(replace.checked && p.currentCount > 0));
    append.addEventListener('change', toggle);
    replace.addEventListener('change', toggle);
    const btn = el('button', { type: 'button', class: 'btn primary', text: 'Confirmar importação' });
    const out = el('div');

    btn.addEventListener('click', async () => {
      const mode = replace.checked ? 'replace' : 'append';
      if (mode === 'replace' && p.currentCount > 0 && !confirmBox.checked) {
        return showAlert(out, 'error', 'Confirme explicitamente a substituição da lista existente.');
      }
      btn.disabled = true;
      try {
        const r = await Api.post('/api/admin/words/import', { previewId: p.previewId, mode, confirmReplace: confirmBox.checked });
        showAlert(mainAlert, 'ok', `${LIST_LABELS[r.listType]}: ${r.inserted} palavras importadas. Total atual: ${r.total}.`);
        await loaders.words();
      } catch (err) {
        btn.disabled = false;
        UI.handleError(err, out);
      }
    });

    box.append(
      el('div', { class: 'field' }, [
        el('label', { class: 'check' }, [append, ' Acrescentar à lista atual']),
        el('label', { class: 'check' }, [replace, ' Substituir a lista atual']),
        confirmLabel,
      ]),
      btn,
      out
    );
  }

  loaders.words = async () => {
    const data = await Api.get('/api/admin/words');
    const pool = clear(document.getElementById('words-pool'));
    if (data.pool.empty) pool.append(el('div', { class: 'alert warn', text: 'Ainda não existe nenhuma lista de palavras secretas com o tamanho configurado. O jogo fica indisponível até ser importada uma lista.' }));
    else if (data.pool.exhausted) pool.append(el('div', { class: 'alert warn', text: data.pool.recycle ? 'Todas as palavras secretas já foram usadas; estão a ser reutilizadas (opção ativa).' : 'A lista de palavras secretas está esgotada! Importe novas palavras ou ative a reutilização nos parâmetros.' }));
    else pool.append(el('div', { class: `alert ${data.pool.unused <= 7 ? 'warn' : 'info'}`, text: `Palavras secretas por usar: ${data.pool.unused} (≈ ${data.pool.unused} dias de jogo).` }));

    const lists = clear(document.getElementById('word-lists'));
    lists.append(wordListCard('secret', data.lists.secret), wordListCard('accepted', data.lists.accepted));

    const body = clear(document.getElementById('imports-body'));
    if (!data.imports.length) body.append(emptyRow(9, 'Ainda não foram feitas importações.'));
    for (const i of data.imports) {
      body.append(el('tr', {}, [
        el('td', { text: UI.formatDateTime(i.imported_at) }),
        el('td', { text: LIST_LABELS[i.list_type] }),
        el('td', { text: i.filename || '—' }),
        el('td', { text: i.mode === 'replace' ? 'Substituição' : 'Acrescento' }),
        el('td', { class: 'num', text: i.valid_count }),
        el('td', { class: 'num', text: i.invalid_count }),
        el('td', { class: 'num', text: i.duplicate_count }),
        el('td', { class: 'num', text: i.inserted_count }),
        el('td', { text: i.imported_by_username }),
      ]));
    }
  };

  // ---------- Utilizadores ----------
  loaders.users = async () => {
    const { users } = await Api.get('/api/admin/users');
    const body = clear(document.getElementById('users-body'));
    for (const u of users) {
      const actions = el('td');
      const renameBtn = el('button', { type: 'button', class: 'btn small', text: 'Alterar nome' });
      renameBtn.addEventListener('click', async () => {
        const name = prompt(`Novo nome de apresentação para "${u.username}" (2 a 40 caracteres):`, u.displayName);
        if (name === null || name.trim() === u.displayName) return;
        try {
          const { user } = await Api.post(`/api/admin/users/${u.id}/display-name`, { displayName: name });
          showAlert(mainAlert, 'ok', `Nome de "${u.username}" alterado para "${user.displayName}".`);
          await loaders.users();
        } catch (err) { fail()(err); }
      });
      actions.append(renameBtn, ' ');
      if (u.id !== me.id) {
        const blockBtn = el('button', { type: 'button', class: `btn small ${u.status === 'active' ? 'danger' : ''}`, text: u.status === 'active' ? 'Bloquear' : 'Reativar' });
        blockBtn.addEventListener('click', async () => {
          if (u.status === 'active' && !confirm(`Bloquear "${u.username}"? As sessões ativas serão terminadas.`)) return;
          try {
            await Api.post(`/api/admin/users/${u.id}/${u.status === 'active' ? 'block' : 'unblock'}`);
            await loaders.users();
          } catch (err) { fail()(err); }
        });
        const pwBtn = el('button', { type: 'button', class: 'btn small', text: 'Redefinir password' });
        pwBtn.addEventListener('click', async () => {
          const pw = prompt(`Nova password para "${u.username}" (mín. 10 caracteres):`);
          if (!pw) return;
          try {
            await Api.post(`/api/admin/users/${u.id}/password`, { password: pw });
            showAlert(mainAlert, 'ok', `Password de "${u.username}" redefinida.`);
          } catch (err) { fail()(err); }
        });
        actions.append(blockBtn, ' ', pwBtn);
      } else {
        actions.append(el('span', { class: 'muted', text: '(a sua conta)' }));
      }
      body.append(el('tr', {}, [
        el('td', { class: 'mono', text: u.username }),
        el('td', { text: u.displayName }),
        el('td', {}, [el('span', { class: `badge ${u.role === 'admin' ? 'admin' : ''}`, text: u.role === 'admin' ? 'Administrador' : 'Utilizador' })]),
        el('td', {}, [el('span', { class: `badge ${u.status === 'blocked' ? 'blocked' : 'won'}`, text: u.status === 'blocked' ? 'Bloqueado' : 'Ativo' })]),
        el('td', { text: UI.formatDateTime(u.lastLoginAt) }),
        actions,
      ]));
    }
    return users;
  };

  document.getElementById('form-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('user-alert');
    try {
      const { user } = await Api.post('/api/admin/users', {
        username: document.getElementById('nu-username').value,
        displayName: document.getElementById('nu-display').value,
        password: document.getElementById('nu-password').value,
        role: document.getElementById('nu-role').value,
      });
      e.target.reset();
      showAlert(alertEl, 'ok', `Utilizador "${user.username}" criado.`);
      await loaders.users();
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  });

  // ---------- Parâmetros ----------
  const NUM_FIELDS = ['word_length', 'max_attempts', 'points_loss', 'streak_bonus_days', 'streak_bonus_points'];
  const TIME_FIELDS = ['play_start', 'play_end'];
  loaders.settings = async () => {
    const { settings } = await Api.get('/api/admin/settings');
    for (const k of NUM_FIELDS) document.getElementById(`s-${k}`).value = settings[k];
    for (const k of TIME_FIELDS) document.getElementById(`s-${k}`).value = settings[k];
    document.getElementById('s-accent_mode').value = settings.accent_mode;
    document.getElementById('s-streak_mode').value = settings.streak_mode;
    document.getElementById('s-points_by_attempt').value = settings.points_by_attempt.join(', ');
    document.getElementById('s-podium_bonus_points').value = settings.podium_bonus_points.join(', ');
    document.getElementById('s-registration_enabled').checked = settings.registration_enabled;
    document.getElementById('s-recycle_words').checked = settings.recycle_words;
    document.getElementById('s-public_leaderboard').checked = settings.public_leaderboard;
  };

  document.getElementById('form-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('settings-alert');
    const body = {};
    for (const k of NUM_FIELDS) body[k] = Number(document.getElementById(`s-${k}`).value);
    for (const k of TIME_FIELDS) body[k] = document.getElementById(`s-${k}`).value.slice(0, 5);
    body.accent_mode = document.getElementById('s-accent_mode').value;
    body.streak_mode = document.getElementById('s-streak_mode').value;
    body.points_by_attempt = document.getElementById('s-points_by_attempt').value.split(/[,;\s]+/).filter(Boolean).map(Number);
    body.podium_bonus_points = document.getElementById('s-podium_bonus_points').value.split(/[,;\s]+/).filter(Boolean).map(Number);
    body.registration_enabled = document.getElementById('s-registration_enabled').checked;
    body.recycle_words = document.getElementById('s-recycle_words').checked;
    body.public_leaderboard = document.getElementById('s-public_leaderboard').checked;
    try {
      const r = await Api.put('/api/admin/settings', body);
      const n = Object.keys(r.changed).length;
      showAlert(alertEl, 'ok', n ? `${n} parâmetro(s) atualizado(s).` : 'Sem alterações.');
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  });

  // ---------- Estatísticas ----------
  loaders.stats = async () => {
    const s = await Api.get('/api/admin/stats');
    clear(document.getElementById('global-stats')).append(
      stat(s.users.active, 'Utilizadores ativos'),
      stat(s.challenges, 'Desafios realizados'),
      stat(s.games.games, 'Jogos'),
      stat(s.games.wins, 'Vitórias'),
      stat(`${s.winRate}%`, 'Taxa de vitórias'),
      stat(s.games.in_progress, 'Jogos em curso')
    );
    const body = clear(document.getElementById('challenges-body'));
    if (!s.pastChallenges.length) body.append(emptyRow(5, 'Ainda não há desafios anteriores.'));
    for (const c of s.pastChallenges) {
      body.append(el('tr', {}, [
        el('td', { text: UI.formatDay(c.challenge_date) }),
        el('td', { class: 'mono', text: c.word }),
        el('td', { class: 'num', text: c.players }),
        el('td', { class: 'num', text: c.wins || 0 }),
        el('td', { class: 'num', text: c.avg_attempts == null ? '—' : c.avg_attempts }),
      ]));
    }
  };

  // ---------- Ajustes de pontos ----------
  loaders.points = async () => {
    const [{ users }, { adjustments }] = await Promise.all([Api.get('/api/admin/users'), Api.get('/api/admin/points/adjustments')]);
    const sel = clear(document.getElementById('adj-user'));
    for (const u of users) sel.append(el('option', { value: u.id, text: `${u.displayName} (${u.username})` }));
    const body = clear(document.getElementById('adjust-body'));
    if (!adjustments.length) body.append(emptyRow(6, 'Sem ajustes registados.'));
    for (const a of adjustments) {
      body.append(el('tr', {}, [
        el('td', { text: UI.formatDateTime(a.created_at) }),
        el('td', { text: `${a.display_name} (${a.username})` }),
        el('td', { class: 'num', text: a.points > 0 ? `+${a.points}` : a.points }),
        el('td', { text: a.reason }),
        el('td', { text: a.season }),
        el('td', { text: a.created_by_username }),
      ]));
    }
  };

  document.getElementById('form-adjust').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('adjust-alert');
    const points = Number(document.getElementById('adj-points').value);
    const reason = document.getElementById('adj-reason').value;
    const userText = document.getElementById('adj-user').selectedOptions[0]?.textContent;
    if (!confirm(`Registar ajuste de ${points} pontos para ${userText}?`)) return;
    try {
      await Api.post('/api/admin/points/adjust', { userId: document.getElementById('adj-user').value, points, reason });
      e.target.reset();
      showAlert(alertEl, 'ok', 'Ajuste registado.');
      await loaders.points();
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  });

  // ---------- Personalização ----------
  const BRAND_TEXT = ['brand_name', 'brand_tagline', 'brand_footer'];

  function showBrandImages(b) {
    const logo = document.getElementById('brand-logo-preview');
    logo.src = b.logoUrl;
    logo.classList.toggle('round', Boolean(b.logoRound));
    const rk = document.getElementById('brand-ranking-preview');
    rk.classList.toggle('hidden', !b.rankingUrl);
    document.getElementById('brand-ranking-none').classList.toggle('hidden', Boolean(b.rankingUrl));
    if (b.rankingUrl) rk.src = b.rankingUrl;
    // Atualiza também o cabeçalho desta página.
    for (const img of document.querySelectorAll('img[data-brand-logo]')) {
      img.src = b.logoUrl;
      img.classList.toggle('round', Boolean(b.logoRound));
    }
    for (const n of document.querySelectorAll('[data-brand="name"]')) n.textContent = b.name;
    for (const n of document.querySelectorAll('[data-brand="tagline"]')) { n.textContent = b.tagline; n.classList.toggle('hidden', !b.tagline); }
    for (const n of document.querySelectorAll('[data-brand="footer"]')) { n.textContent = b.footer; n.classList.toggle('hidden', !b.footer); }
  }

  loaders.brand = async () => {
    const [{ settings }, brand] = await Promise.all([Api.get('/api/admin/settings'), Api.get('/api/brand')]);
    for (const k of BRAND_TEXT) document.getElementById(`b-${k}`).value = settings[k];
    document.getElementById('b-brand_logo_round').checked = settings.brand_logo_round;
    showBrandImages(brand);
  };

  document.getElementById('form-brand').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('brand-text-alert');
    const body = {};
    for (const k of BRAND_TEXT) body[k] = document.getElementById(`b-${k}`).value.trim();
    body.brand_logo_round = document.getElementById('b-brand_logo_round').checked;
    try {
      await Api.put('/api/admin/settings', body);
      showBrandImages(await Api.get('/api/brand'));
      showAlert(alertEl, 'ok', 'Personalização guardada.');
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  });

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
      r.readAsDataURL(file);
    });

  for (const kind of ['logo', 'ranking']) {
    const alertEl = document.getElementById(`brand-${kind}-alert`);
    document.getElementById(`brand-${kind}-upload`).addEventListener('click', async () => {
      const file = document.getElementById(`brand-${kind}-file`).files[0];
      if (!file) return showAlert(alertEl, 'error', 'Escolha uma imagem PNG, JPEG ou WEBP.');
      if (file.size > 2 * 1024 * 1024) return showAlert(alertEl, 'error', 'Imagem demasiado grande (máximo 2 MB).');
      try {
        const b = await Api.post(`/api/admin/brand/${kind}`, { filename: file.name, data: await readAsDataUrl(file) });
        showBrandImages(b);
        showAlert(alertEl, 'ok', 'Imagem atualizada.');
      } catch (err) {
        UI.handleError(err, alertEl);
      }
    });
    document.getElementById(`brand-${kind}-remove`).addEventListener('click', async () => {
      if (!confirm(kind === 'logo' ? 'Repor o logótipo predefinido?' : 'Remover a imagem do ranking?')) return;
      try {
        showBrandImages(await Api.post(`/api/admin/brand/${kind}/remove`));
        showAlert(alertEl, 'ok', 'Feito.');
      } catch (err) {
        UI.handleError(err, alertEl);
      }
    });
  }

  // ---------- Auditoria ----------
  loaders.audit = async () => {
    const { entries } = await Api.get('/api/admin/audit');
    const body = clear(document.getElementById('audit-body'));
    if (!entries.length) body.append(emptyRow(5, 'Sem registos.'));
    for (const a of entries) {
      body.append(el('tr', {}, [
        el('td', { text: UI.formatDateTime(a.created_at) }),
        el('td', { text: a.actor || 'sistema' }),
        el('td', { class: 'mono', text: a.action }),
        el('td', { text: a.target || '—' }),
        el('td', { class: 'mono', text: a.details ? JSON.stringify(a.details) : '' }),
      ]));
    }
  };

  UI.initPage({ requireAdmin: true })
    .then((s) => {
      me = s.user;
      show('status');
    })
    .catch((err) => err.message !== 'redirect' && fail()(err));
})();
