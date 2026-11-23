# Wordle League

Jogo de palavras diário, inspirado no Wordle, para equipas e grupos de amigos. Tem pontuação, streaks, bónus, classificações diária, mensal e desde sempre, e um painel de administração. **O nome, o subtítulo, o rodapé e o logótipo são personalizáveis no painel**, sem mexer em código.

- **Uma palavra por dia, igual para todos.** Muda à meia-noite de Portugal (`Europe/Lisbon`) e só se pode jogar no período definido (por omissão, das 09:30 às 00:00).
- **App para iPhone e Android.** É uma *web app* (PWA): abre-se no Safari e instala-se no ecrã principal com **Partilhar → Adicionar ao ecrã principal**. Também funciona em qualquer computador.
- **Sem servidor próprio e sem custos.** O site está no **GitHub Pages** e os dados no **Supabase** (plano gratuito). Não é preciso ter nenhum computador ligado.
- **A palavra secreta nunca chega ao browser antes de o jogador terminar.** A avaliação das tentativas e a pontuação são feitas dentro da base de dados.

> **As listas de palavras não estão neste repositório.** A lista de palavras secretas revelaria as respostas. Importe as listas no painel depois de instalar (ver [Listas de palavras](#listas-de-palavras)).

> A versão anterior, com servidor Node.js + SQLite (Windows/Docker), continua disponível na marca `v1.5.0-servidor`.

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Instalar no telemóvel](#instalar-no-telemóvel)
- [Listas de palavras](#listas-de-palavras)
- [Personalização](#personalização)
- [Parâmetros do jogo](#parâmetros-do-jogo)
- [Regras e pontuação](#regras-e-pontuação)
- [Como funciona](#como-funciona)
- [Segurança](#segurança)
- [Custos e limites](#custos-e-limites)
- [Desenvolvimento e testes](#desenvolvimento-e-testes)
- [Decisões técnicas e limitações](#decisões-técnicas-e-limitações)

---

## Funcionalidades

| Página | Quem | O que faz |
|---|---|---|
| **Jogar** (`index.html`) | jogadores | Grelha do jogo, teclado virtual e físico, e contagem decrescente até à abertura ou ao fecho. No fim mostra a palavra, os pontos e os bónus. |
| **Classificação** | jogadores e admin | Classificação diária (por data), mensal (com histórico de meses) e desde sempre. |
| **Perfil** | jogadores e admin | Jogos, vitórias, % de vitórias, distribuição por tentativas, streak atual e melhor, melhor posição mensal, histórico e origem de cada ponto. Permite também alterar a password. |
| **Regras** | todos com sessão | Regras do jogo geradas a partir dos parâmetros atuais: se o admin os mudar, o texto muda sozinho. |
| **Admin** | administradores | Estado, palavras (importar/exportar), utilizadores (criar, bloquear, renomear, redefinir password), parâmetros, personalização, estatísticas, ajustes de pontos e auditoria. |
| **Ranking público** (`ranking.html`) | qualquer pessoa (desativável) | Classificação **do mês em curso**, pensada para ficar aberta num ecrã. Atualiza-se a cada minuto. |
| **Entrar** (`login.html`) | — | Entrar e criar conta (o registo pode ser desligado). |

Outros pormenores:
- Interface em português de Portugal, com tema escuro, adaptada a desktop, tablet e telemóvel.
- Modo para daltonismo (botão ◐ no menu).
- Os administradores não têm o separador "Jogar" e entram diretamente no painel.

## Instalação

São cerca de 15 minutos, sem instalar nada no computador. O guia passo a passo está em **[COMO-INSTALAR.md](COMO-INSTALAR.md)**. Em resumo:

1. Criar um projeto gratuito no **Supabase**, colar o [`supabase/1-esquema.sql`](supabase/1-esquema.sql) no *SQL Editor* e carregar em **Run**.
2. Em **Authentication**, desligar a confirmação por email.
3. Copiar o endereço do projeto e a chave pública para o [`config.js`](config.js).
4. Ligar o **GitHub Pages** neste repositório (ramo `main`, pasta `/`).
5. Abrir o site e **criar a primeira conta: fica automaticamente administradora**. Depois, importar as listas de palavras no painel.

## Instalar no telemóvel

- **iPhone/iPad:** abra o site no **Safari** → botão **Partilhar** → **Adicionar ao ecrã principal**.
- **Android:** abra no **Chrome** → menu **⋮** → **Instalar aplicação** (ou *Adicionar ao ecrã principal*).

A app abre em ecrã inteiro, com ícone próprio, e recebe as atualizações automaticamente.

## Listas de palavras

Há duas listas independentes, ambas importadas no painel (**Admin → Palavras**):

| Lista | Para que serve |
|---|---|
| **Palavras secretas** | De onde sai a palavra de cada dia. Cada palavra é usada uma vez até a lista se esgotar. |
| **Palavras aceites** | Validação das tentativas. As palavras secretas são sempre aceites. Uma lista grande evita "Palavra não reconhecida". |

**Formatos** (UTF-8):
- **TXT:** uma palavra por linha; as linhas vazias e as começadas por `#` são ignoradas.
- **CSV:** usa a primeira coluna; o cabeçalho `palavra` é opcional.

Veja os exemplos em [examples/](examples/).

**Importar:**
1. Escolha o ficheiro e clique em **Analisar ficheiro**.
2. Reveja o resumo (válidas, inválidas com o motivo, duplicadas, já existentes).
3. Escolha **Acrescentar** ou **Substituir**. Substituir uma lista com palavras exige confirmação explícita.

**Validação:** aceita maiúsculas ou minúsculas; exige o número de letras configurado; só aceita `A–Z` e `Á À Â Ã É Ê Í Ó Ô Õ Ú Ç`. Os acentos são guardados e mostrados como estão no ficheiro.

**Avisos:** o painel avisa quando não há lista, quando restam 7 ou menos palavras secretas e quando a lista se esgota. A lista não recomeça sozinha, a menos que ative **Reutilizar palavras**.

> **Guarde as listas reais fora do repositório.** A pasta [listas/](listas/LEIA-ME.md) existe para isso e o conteúdo está no `.gitignore` (este repositório é público). **Nunca** publique a lista de palavras secretas.

**Fontes de listas de palavras aceites (inglês):**
- [ENABLE](https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt): domínio público.
- [lista de tentativas do Wordle](https://github.com/tabatkins/wordle-list).

Use estas fontes **só** como palavras aceites, nunca como secretas: têm muitas palavras obscuras.

## Personalização

Tudo se configura em **Admin → Personalização** e aplica-se a todas as páginas (cabeçalho, login, títulos do separador, rodapé e ranking público):

| Opção | Omissão | Notas |
|---|---|---|
| Nome do jogo | `Wordle League` | 2 a 40 caracteres. |
| Subtítulo | `Desafio diário de palavras` | Opcional (vazio = não aparece). |
| Rodapé | `Uso interno` | Opcional. |
| Logótipo | "W" neutro | PNG, JPEG ou WEBP, de preferência quadrado, até 2 MB. Opção para o recortar em círculo. |
| Imagem do ranking público | — | Opcional: imagem grande (ao alto) do lado direito. Sem ela, é usado o logótipo com brilho sobre um fundo neutro. |

As imagens ficam no **Storage do Supabase** (pasta pública `marca`); só administradores as podem enviar ou apagar. O tipo é verificado pelo conteúdo do ficheiro e **não são aceites SVG** (podem conter scripts). Com um logótipo próprio em **PNG ou JPEG** (quadrado, sem transparência, 180×180 ou mais), esse logótipo passa a ser também o ícone da app no **iPhone** ao *Adicionar ao ecrã principal* — a imagem vem do Supabase e nunca entra no repositório. Quem já tinha a app instalada tem de a remover e voltar a adicionar. No **Android** o ícone é sempre o "W" predefinido (pasta [`icons/`](icons/)).

## Parâmetros do jogo

Configuram-se em **Admin → Parâmetros**:

| Parâmetro | Omissão |
|---|---|
| Letras por palavra / tentativas | 5 / 6 |
| Pontos por vitória na 1.ª–6.ª tentativa | 100, 80, 65, 50, 35, 25 |
| Pontos por participação sem vitória | 5 |
| **Período de jogo** (hora de Portugal; 00:00 = meia-noite) | das 09:30 às 00:00 |
| **Bónus de pódio** (1.º, 2.º, 3.º… a acertar no dia) | 15, 10, 5 (lista livre; vazia = desativado) |
| Bónus de streak | +15 a cada 7 dias consecutivos |
| Contagem da streak | dias seguidos com vitória (ou dias seguidos a jogar) |
| Acentos | ignorados (`MAÇÃS` = `MACAS`); em alternativa, contam |
| Registo de novas contas | ativo |
| Reutilizar palavras quando a lista secreta se esgota | inativo |
| Ranking público (`ranking.html`) | ativo |

As alterações ficam na auditoria. O tamanho das palavras, as tentativas e a política de acentos aplicam-se a partir do desafio seguinte. **Os pontos já atribuídos nunca são recalculados.**

## Regras e pontuação

Os jogadores têm a explicação completa na página **Regras**, gerada a partir dos parâmetros. Em resumo:

- **Avaliação das letras:** verde (posição certa), amarelo (existe noutra posição) e cinzento (não existe, ou já foram assinaladas todas as ocorrências). As letras repetidas são tratadas em duas passagens.
- **Palavras desconhecidas:** são rejeitadas **sem gastar tentativa**.
- **Um jogo por pessoa e por dia,** só dentro do período de jogo. Antes da abertura, a palavra do dia nem sequer é escolhida.
- **Pontos de um jogo:** os da vitória (consoante a tentativa) ou os de participação. A estes juntam-se:
  - **Pódio do dia:** +15, +10 e +5 para os três primeiros a acertar. Conta a hora a que acertaram; uma derrota não ocupa posição.
  - **Streak:** +15 quando a streak chega a 7, 14, 21… dias.
- **Jogos a meio:** um jogo começado e não terminado é fechado no dia seguinte como "não concluído", com os pontos de participação.
- **Classificações:**
  - **diária:** pontos do dia, com bónus; em caso de empate, ganha quem usou menos tentativas e, depois, quem terminou primeiro;
  - **mensal:** recomeça no dia 1, e os meses anteriores ficam guardados;
  - **desde sempre:** soma de todos os pontos.
- **Correções:** os pontos ficam num **livro só de acrescento**. As correções são **ajustes administrativos** com motivo obrigatório, visíveis ao jogador e na auditoria.

## Como funciona

```
 Browser / app no telemóvel                 Supabase (plano gratuito)
 ─────────────────────────────              ─────────────────────────────────────────
 GitHub Pages: HTML + CSS + JS   ──Auth──▶  Contas (email interno = utilizador@wordle-league.local)
   js/api.js traduz cada pedido  ──RPC───▶  Funções em "public" (get_game_state, submit_guess, …)
   numa chamada ao Supabase                    │  validam, avaliam, pontuam (SECURITY DEFINER)
                                 ──Storage▶    ▼
                                            Esquema privado "wl" (tabelas): nunca exposto à API
                                            Bucket "marca": logótipo e imagem do ranking
```

| Pasta / ficheiro | Conteúdo |
|---|---|
| `*.html`, `css/`, `js/`, `img/`, `icons/` | O site (publicado tal como está pelo GitHub Pages). |
| `config.js` | Endereço e chave pública do Supabase. |
| `manifest.webmanifest`, `sw.js` | O que torna o site instalável como app. |
| `js/api.js` | Recebe os pedidos das páginas (`/api/game/today`, `/api/admin/users`, …) e chama as funções do Supabase. |
| `js/vendor/supabase.js` | Biblioteca oficial `@supabase/supabase-js` (cópia local, sem CDN). |
| `supabase/1-esquema.sql` | Tabelas, regras e todas as funções da base de dados. Pode ser executado de novo para atualizar, sem perder dados. |
| `.github/workflows/despertador.yml` | Pedido diário ao Supabase para o projeto gratuito não ser pausado por inatividade. |
| `test/` | Testes automáticos e simulador local (ver [Desenvolvimento e testes](#desenvolvimento-e-testes)). |

**Contas:** cada pessoa entra com o **nome de utilizador**. Por baixo, o Supabase Auth guarda-o como um email interno (`ana@wordle-league.local`), que nunca é usado para enviar mensagens. Não há recuperação de password por email: um administrador redefine-a no painel.

## Segurança

- **Tabelas inacessíveis à internet.** Estão no esquema `wl`, que não é exposto pela API, têm RLS ativo e nenhuma permissão para `anon`/`authenticated`. O browser só pode chamar as funções da app, e cada função verifica a sessão, o estado da conta e, nas de administração, o papel.
- **Palavra secreta protegida.** A escolha (SHA-256 com semente secreta guardada na BD), a validação e a avaliação das tentativas são feitas na base de dados; a solução só é devolvida a quem já terminou o jogo desse dia. O painel só mostra palavras de dias anteriores.
- **Pontos à prova de batota.** Os pontos são calculados na BD, num livro só de acrescento; *triggers* impedem alterar ou apagar resultados, tentativas, pontos e auditoria; índices únicos impedem pontos ou bónus a dobrar, mesmo com pedidos simultâneos.
- **Chave pública no `config.js`:** é a chave *publishable/anon*, feita para estar no browser. Sozinha não dá acesso a nenhum dado.
- **Contas:** passwords com 10+ caracteres, guardadas pelo Supabase (bcrypt). Bloquear uma conta corta o acesso de imediato e termina as sessões. A primeira conta criada fica administradora.
- **Browser:** *Content Security Policy* restritiva (só scripts do próprio site), sem `innerHTML` com dados (usa `textContent`), nomes sem `<` nem `>`.
- **Fora do repositório:** ative a verificação em dois passos (2FA) nas contas do **GitHub** e do **Supabase** — quem entrar nelas controla a app e os dados.

## Custos e limites

- **GitHub Pages e Actions:** gratuitos em repositórios públicos.
- **Supabase (plano gratuito):** 500 MB de base de dados (o jogo usa uma fração mínima), 1 GB de ficheiros, sem cartão. O projeto é **pausado ao fim de 7 dias sem uso**; o [despertador](.github/workflows/despertador.yml) evita isso. Se mesmo assim acontecer, os dados não se perdem: basta carregar em **Restore project** em supabase.com.

## Desenvolvimento e testes

Requer Node.js 22 ou superior.

```bash
npm install
npm test        # testes da base de dados (PostgreSQL em memória) e dos módulos do browser
npm run serve   # app completa em http://localhost:5173 com um simulador local do Supabase
```

O simulador cria as contas `admin` e `ana` (password `password-de-teste-123`) e listas de palavras de teste. Os testes carregam o `supabase/1-esquema.sql` num PostgreSQL 17 em memória ([PGlite](https://pglite.dev)) e cobrem o jogo, a pontuação, as streaks, o pódio, o período de jogo, as classificações, as permissões e a importação.

**Publicar alterações:** basta enviar para o ramo `main` (o GitHub Pages atualiza em 1–2 minutos). Ao mudar ficheiros do site, aumente o número da versão em `sw.js` (`wordle-league-vN`) para as apps instaladas receberem logo a atualização. Ao mudar o `supabase/1-esquema.sql`, cole-o de novo no *SQL Editor* do Supabase e carregue em **Run**.

## Decisões técnicas e limitações

Ver **[docs/DECISOES.md](docs/DECISOES.md)**: estratégia de seleção da palavra, política de acentos, definição de streak, bónus, período de jogo e limitações conhecidas.

## Licença

Projeto criado para uso interno de uma equipa. Ainda não foi definida nenhuma licença de distribuição.
