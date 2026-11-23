/* Página de regras: o texto é gerado a partir dos parâmetros definidos pelo administrador. */
(function () {
  'use strict';
  const { el } = UI;

  const card = (title, children) => el('section', { class: 'card' }, [el('h2', { text: title }), ...children]);
  const p = (...parts) => el('p', {}, parts);
  const strong = (text) => el('strong', { text: String(text) });
  const li = (...parts) => el('li', {}, parts);

  /** Grelha de exemplo com cores (puramente ilustrativa). */
  function example(word, pattern) {
    const row = el('div', { class: 'rules-example', 'aria-hidden': 'true' });
    Array.from(word).forEach((letter, i) => row.append(el('span', { class: `tile ${pattern[i]}`, text: letter })));
    return row;
  }

  const DAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  /** [1,2,3,4,5] → "de segunda a sexta"; [1,3,5] → "à segunda, quarta e sexta". */
  function daysText(days) {
    const d = [...(days || [])].sort((a, b) => a - b);
    if (d.length === 7) return 'todos os dias';
    const consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    if (consecutive) return `de ${DAY_NAMES[d[0] - 1]} a ${DAY_NAMES[d[d.length - 1] - 1]}`;
    const names = d.map((x) => DAY_NAMES[x - 1]);
    return `${d[0] >= 6 ? 'ao' : 'à'} ${names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0]}`;
  }

  const fmtHour = (h) => (h === '00:00' ? 'à meia-noite (00:00)' : `às ${h}`);
  const pts = (n) => `${n} ponto${n === 1 ? '' : 's'}`;

  function render(r) {
    const root = document.getElementById('rules');
    const scheduleFullDay = r.playStart === '00:00' && r.playEnd === '00:00';
    const streakText = r.streakMode === 'participation' ? 'dias seguidos em que joga (ganhando ou não)' : 'dias seguidos em que acerta na palavra';

    // 1. Como jogar
    root.append(card('Como jogar', [
      p(...(r.playDays && r.playDays.length ? ['Há jogo ', strong(daysText(r.playDays)), '. Em cada dia de jogo há uma '] : ['Todos os dias há uma ']), strong('palavra secreta'), ` de ${r.wordLength} letras, igual para toda a gente. Tem `, strong(`${r.maxAttempts} tentativas`), ' para a descobrir.'),
      scheduleFullDay
        ? p('O jogo está aberto durante todo o dia. A palavra muda à meia-noite (hora de Portugal).')
        : p('O jogo está aberto ', strong(`das ${r.playStart} ${r.playEnd === '00:00' ? 'até à meia-noite' : `às ${r.playEnd}`}`),
            ' (hora de Portugal). Fora deste período não é possível jogar. A palavra muda à meia-noite.'),
      p('Depois de cada tentativa, as letras mudam de cor:'),
      el('ul', { class: 'rules-legend' }, [
        li(el('span', { class: 'tile correct', text: 'A' }), ' ', strong('Verde'), ': a letra está na palavra e na posição certa.'),
        li(el('span', { class: 'tile present', text: 'B' }), ' ', strong('Amarelo'), ': a letra está na palavra, mas noutra posição.'),
        li(el('span', { class: 'tile absent', text: 'C' }), ' ', strong('Cinzento'), ': a letra não está na palavra (ou já foram assinaladas todas as vezes que aparece).'),
      ]),
      r.wordLength === 5 ? example('HOUSE', ['correct', 'absent', 'present', 'absent', 'correct']) : null,
      r.wordLength === 5 ? p(el('small', { class: 'muted', text: 'Exemplo: H e E estão certos, U existe noutra posição, O e S não fazem parte da palavra.' })) : null,
      el('ul', {}, [
        li('Só são aceites palavras que existam na lista do jogo. Uma palavra desconhecida ', strong('não gasta tentativa'), '.'),
        li('Letras repetidas contam à parte: se a palavra só tiver um A, só um A da sua tentativa fica colorido.'),
        li(r.accentMode === 'strict'
          ? 'Os acentos contam: Á e A são letras diferentes (use as teclas acentuadas).'
          : 'Os acentos e a cedilha são ignorados: pode escrever sem acentos (Á = A, Ç = C).'),
        li('Cada pessoa joga ', strong('uma vez por dia'), '. O jogo acaba quando acerta ou quando esgota as tentativas.'),
      ]),
    ]));

    // 2. Pontuação
    const table = el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Resultado' }), el('th', { class: 'num', text: 'Pontos' })])]),
      el('tbody', {}, [
        ...r.pointsByAttempt.map((n, i) => el('tr', {}, [
          el('td', { text: `Vitória à ${i + 1}.ª tentativa` }),
          el('td', { class: 'num', text: n }),
        ])),
        el('tr', {}, [el('td', { text: 'Jogou mas não acertou' }), el('td', { class: 'num', text: r.pointsLoss })]),
      ]),
    ]);
    const bonuses = [];
    const podium = r.podiumBonus.map((n, i) => ({ pos: i + 1, n })).filter((x) => x.n > 0);
    if (podium.length) {
      bonuses.push(li(
        strong('Pódio do dia: '),
        podium.map((x) => `${x.pos}.º a acertar +${pts(x.n)}`).join(' · '),
        '. Conta a ordem por que cada pessoa descobriu a palavra (a hora a que acertou, não a hora a que começou).'
      ));
    }
    if (r.streakBonusPoints > 0) {
      bonuses.push(li(strong(`Streak: +${pts(r.streakBonusPoints)}`), ` sempre que chega a ${r.streakBonusDays}, ${r.streakBonusDays * 2}, ${r.streakBonusDays * 3}… ${streakText}.`));
    }
    root.append(card('Pontuação', [
      el('div', { class: 'table-wrap' }, [table]),
      bonuses.length ? el('h3', { text: 'Bónus' }) : null,
      bonuses.length ? el('ul', {}, bonuses) : p('De momento não há bónus ativos.'),
      p(el('small', { class: 'muted', text: 'Os pontos são calculados e guardados no servidor. Alterações às regras não mudam pontos já atribuídos.' })),
    ]));

    // 3. Streak
    root.append(card('Streak', [
      p('A streak conta os ', strong(streakText), ', contando só os dias de jogo: os dias sem desafio (por exemplo, o fim de semana) e os dias em que ninguém jogou não a interrompem. ',
        r.streakMode === 'participation' ? 'Não jogar num dia de jogo volta a pôr a streak a zero.' : 'Perder ou não jogar num dia de jogo volta a pôr a streak a zero.'),
      p('Se num dia de jogo ninguém jogar, a palavra desse dia passa para o dia de jogo seguinte.'),
      p('A streak atual e a melhor streak aparecem no seu Perfil.'),
    ]));

    // 4. Classificações
    root.append(card('Classificações', [
      el('ul', {}, [
        li(strong('Diária'), ': pontos do desafio do dia (com bónus). Em caso de empate, fica à frente quem usou menos tentativas e, depois, quem terminou primeiro.'),
        li(strong('Mensal'), ': soma dos pontos do mês. Recomeça no dia 1 de cada mês; os meses anteriores ficam guardados.'),
        li(strong('Desde sempre'), ': soma de todos os pontos.'),
      ]),
    ]));

    // 5. Outras regras
    root.append(card('Outras regras', [
      el('ul', {}, [
        !scheduleFullDay && r.playEnd !== '00:00'
          ? li(`Um jogo começado e não terminado até ${fmtHour(r.playEnd)} já não pode ser continuado.`)
          : null,
        li('Um jogo começado e não terminado conta como "não concluído" no dia seguinte e recebe os pontos de participação.'),
        li('A palavra do dia só é revelada a quem já terminou o seu jogo. Não a partilhe com quem ainda está a jogar!'),
        li('Qualquer correção de pontos feita pela administração fica registada e visível no seu Perfil.'),
      ]),
    ]));
  }

  UI.initPage()
    .then(() => Api.get('/api/rules'))
    .then(render)
    .catch((err) => err.message !== 'redirect' && UI.handleError(err, document.getElementById('rules-alert')));
})();
