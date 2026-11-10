/* Página do jogo. Toda a avaliação acontece no servidor: aqui só se apresenta o estado. */
(function () {
  'use strict';
  const { el, clear, toast, showAlert } = UI;
  const N = WordNormalize;

  const boardEl = document.getElementById('board');
  const kbEl = document.getElementById('keyboard');
  const resultEl = document.getElementById('result');
  const alertEl = document.getElementById('game-alert');
  const srStatus = document.getElementById('sr-status');

  let state = null;
  let input = [];
  let busy = false;
  let clockOffset = 0;
  let countdownTimer = null;

  const STATUS_SR = { correct: 'correta', present: 'presente noutra posição', absent: 'ausente' };

  function keyOf(letter) {
    return state.accentMode === 'strict' ? letter : N.stripAccents(letter);
  }

  function isPlaying() {
    return state && state.available && (!state.window || state.window.open) && (state.status === 'not_started' || state.status === 'in_progress');
  }

  // ---------- Grelha ----------
  function renderBoard(revealRow = -1) {
    clear(boardEl);
    const cols = state.wordLength;
    for (let r = 0; r < state.maxAttempts; r++) {
      const row = el('div', { class: 'board-row', role: 'row' });
      row.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      const guess = state.guesses[r];
      const letters = guess ? N.letters(guess.word) : r === state.guesses.length ? input : [];
      for (let c = 0; c < cols; c++) {
        const tile = el('div', { class: 'tile', role: 'gridcell', text: letters[c] || '' });
        if (letters[c]) tile.classList.add('filled');
        if (guess) {
          tile.classList.add(guess.pattern[c]);
          tile.setAttribute('aria-label', `${letters[c]}: ${STATUS_SR[guess.pattern[c]]}`);
          if (r === revealRow) {
            tile.classList.add('reveal');
            tile.style.animationDelay = `${c * 0.18}s`;
          }
        }
        row.append(tile);
      }
      if (guess && state.status === 'won' && r === state.guesses.length - 1 && r === revealRow) {
        setTimeout(() => row.classList.add('win'), cols * 180 + 300);
      }
      boardEl.append(row);
    }
  }

  function currentRow() {
    return boardEl.children[state.guesses.length];
  }

  function shake() {
    const row = currentRow();
    if (!row) return;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  // ---------- Teclado ----------
  function keyboardRows() {
    const rows = [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
    ];
    if (state.accentMode === 'strict') {
      rows[1].push('Ç');
      rows.unshift(N.ACCENTED_LETTERS.replace('Ç', '').split(''));
    }
    return rows;
  }

  function keyColors() {
    const rank = { absent: 1, present: 2, correct: 3 };
    const colors = {};
    for (const g of state.guesses) {
      N.letters(g.word).forEach((letter, i) => {
        const k = keyOf(letter);
        const p = g.pattern[i];
        if (!colors[k] || rank[p] > rank[colors[k]]) colors[k] = p;
      });
    }
    return colors;
  }

  function renderKeyboard() {
    clear(kbEl);
    const colors = keyColors();
    for (const row of keyboardRows()) {
      const rowEl = el('div', { class: 'kb-row' });
      for (const k of row) {
        let label = k;
        let aria = k;
        if (k === 'ENTER') { label = 'ENTER'; aria = 'Submeter'; }
        if (k === 'BACK') { label = '⌫'; aria = 'Apagar'; }
        const btn = el('button', { type: 'button', class: 'key', 'data-key': k, 'aria-label': aria, text: label });
        if (k === 'ENTER' || k === 'BACK') btn.classList.add('wide');
        const color = colors[k];
        if (color) btn.classList.add(color);
        btn.disabled = !isPlaying();
        rowEl.append(btn);
      }
      kbEl.append(rowEl);
    }
  }

  kbEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    btn.blur();
    press(btn.dataset.key);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Enter') { e.preventDefault(); press('ENTER'); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('BACK'); }
    else if (e.key.length === 1) {
      const up = N.toDisplay(e.key);
      if (N.isValidCharacters(up)) press(up);
    }
  });

  function press(key) {
    if (!isPlaying() || busy) return;
    if (key === 'ENTER') return submit();
    if (key === 'BACK') {
      input.pop();
    } else if (input.length < state.wordLength) {
      input.push(state.accentMode === 'strict' ? key : N.stripAccents(key));
    }
    renderBoard();
  }

  // ---------- Submissão ----------
  async function submit() {
    if (input.length !== state.wordLength) {
      shake();
      toast('Letras insuficientes');
      return;
    }
    busy = true;
    try {
      const next = await Api.post('/api/game/guess', { guess: input.join('') });
      state = next;
      input = [];
      renderAll(state.guesses.length - 1);
      const last = state.guesses[state.guesses.length - 1];
      srStatus.textContent = `${last.word}: ` + last.pattern.map((p, i) => `${N.letters(last.word)[i]} ${STATUS_SR[p]}`).join(', ');
      if (state.status === 'won') setTimeout(() => toast(['Genial!', 'Magnífico!', 'Impressionante!', 'Excelente!', 'Muito bem!', 'Ufa!'][state.guesses.length - 1] || 'Muito bem!'), state.wordLength * 180 + 200);
    } catch (err) {
      if (err.status === 422) {
        shake();
        toast(err.message);
      } else if (err.status === 409) {
        toast(err.message, 2500);
        await load();
      } else {
        UI.handleError(err);
      }
    } finally {
      busy = false;
    }
  }

  // ---------- Resultado e estado ----------
  function renderResult() {
    clear(resultEl);
    if (!state.available || isPlaying()) {
      resultEl.classList.add('hidden');
      return;
    }
    resultEl.classList.remove('hidden');
    const won = state.status === 'won';
    resultEl.append(
      el('h2', { text: won ? `Vitória em ${state.attemptsUsed}/${state.maxAttempts}!` : state.status === 'expired' ? 'Jogo não concluído' : 'Não foi desta vez' }),
      el('p', { class: 'muted', text: 'A palavra era' }),
      el('p', { class: 'solution', text: state.solution }),
      el('p', { class: 'points', text: `+${state.points} pts` }),
      ...(state.bonuses || []).map((b) =>
        el('p', { class: 'alert ok', text: `${b.type === 'first_win_bonus' ? `Bónus: ${b.rank}.º a acertar hoje!` : 'Bónus de streak'} +${b.points} pts` })
      ),
      el('p', {}, [el('a', { class: 'btn', href: '/leaderboard', text: 'Ver classificação' }), ' ', el('a', { class: 'btn', href: '/profile', text: 'As minhas estatísticas' })])
    );
  }

  function renderAll(revealRow = -1) {
    document.getElementById('challenge-date').textContent = UI.formatDay(state.date);
    if (!state.available) {
      showAlert(alertEl, 'warn', state.message);
      clear(boardEl);
      clear(kbEl);
      document.getElementById('attempts-info').textContent = '';
      renderResult();
      return;
    }
    clear(alertEl);
    if (state.window && !state.window.open && state.status === 'in_progress') {
      showAlert(alertEl, 'warn', `O período de jogo terminou às ${state.window.end}. Este jogo fica por concluir.`);
    }
    renderBoard(revealRow);
    renderKeyboard();
    renderResult();
    document.getElementById('attempts-info').textContent = isPlaying()
      ? `Tentativas restantes: ${state.attemptsLeft} de ${state.maxAttempts}`
      : '';
  }

  // ---------- Temporizador (meia-noite de Portugal, calculada pelo servidor) ----------
  function startCountdown() {
    clearInterval(countdownTimer);
    const w = state.window;
    let label = 'Próximo desafio em';
    let targetIso = state.nextChallengeAt;
    if (w && !w.open) {
      label = 'O jogo abre em';
      targetIso = w.opensAt;
    } else if (w && w.end !== '00:00') {
      label = `Fecha às ${w.end}, daqui a`;
      targetIso = w.closesAt;
    }
    document.getElementById('countdown-label').textContent = label;
    const target = new Date(targetIso).getTime();
    const out = document.getElementById('countdown');
    const tick = () => {
      const left = target - (Date.now() + clockOffset);
      if (left <= 0) {
        clearInterval(countdownTimer);
        out.textContent = '00:00:00';
        setTimeout(load, 1500);
        return;
      }
      const s = Math.floor(left / 1000);
      out.textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function load() {
    try {
      const before = Date.now();
      state = await Api.get('/api/game/today');
      clockOffset = new Date(state.serverNow).getTime() - (before + Date.now()) / 2;
      input = [];
      renderAll();
      startCountdown();
    } catch (err) {
      UI.handleError(err, alertEl);
    }
  }

  UI.initPage()
    .then((session) => {
      // Administradores não jogam: vão diretamente para o painel.
      if (session.user.role === 'admin') return location.replace('/admin');
      return load();
    })
    .catch(() => {});
})();
