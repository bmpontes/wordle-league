# Wordle League

Jogo de palavras diário, inspirado no Wordle, para equipas e organizações. **O nome, o subtítulo, o rodapé e o logótipo são personalizáveis no painel**, sem mexer em código. Tem pontuação, streaks, bónus, classificações diária, mensal e de sempre, e um painel de administração.

- **Uma palavra por dia, igual para todos.** Muda à meia-noite de Portugal (`Europe/Lisbon`) e só se pode jogar no período definido (por omissão, das 09:30 às 00:00).
- **Avaliação feita só no servidor.** A palavra secreta nunca chega ao browser antes de o jogador terminar.
- **Funciona sem Internet.** Não usa APIs externas; as palavras são importadas pelo administrador (TXT/CSV).
- **Tecnologia simples:** Node.js + Express, SQLite e HTML/CSS/JS sem frameworks. Instala-se no Windows com scripts PowerShell ou em Linux com Docker.

> **As listas de palavras não estão neste repositório.** A lista de palavras secretas revelaria as respostas. Importe as listas no painel depois de instalar (ver [Listas de palavras](#listas-de-palavras)).

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
  - [Windows (produção)](#windows-produção)
  - [Linux com Docker](#linux-com-docker)
  - [Desenvolvimento local](#desenvolvimento-local)
- [Primeiro administrador](#primeiro-administrador)
- [Listas de palavras](#listas-de-palavras)
- [Personalização](#personalização)
- [Configuração](#configuração)
- [Regras e pontuação](#regras-e-pontuação)
- [Operação: backups, restauro e atualizações](#operação-backups-restauro-e-atualizações)
- [Segurança](#segurança)
- [Testes](#testes)
- [Arquitetura](#arquitetura)
- [API](#api)
- [Decisões técnicas e limitações](#decisões-técnicas-e-limitações)

---

## Funcionalidades

| Página | Quem | O que faz |
|---|---|---|
| `/` **Jogar** | jogadores | Grelha do jogo, teclado virtual e físico, e contagem decrescente até à abertura ou ao fecho. No fim mostra a palavra, os pontos e os bónus. |
| `/leaderboard` **Classificação** | jogadores e admin | Classificação diária (por data), mensal (com histórico de meses) e desde sempre. |
| `/profile` **Perfil** | jogadores e admin | Jogos, vitórias, % de vitórias, distribuição por tentativas, streak atual e melhor, melhor posição mensal, histórico e origem de cada ponto. Permite também alterar a password. |
| `/regras` **Regras** | todos com sessão | Regras do jogo geradas a partir dos parâmetros atuais: se o admin os mudar, o texto muda sozinho. |
| `/admin` **Admin** | administradores | Estado, palavras (importar/exportar), utilizadores (criar, bloquear, renomear, redefinir password), parâmetros, personalização, estatísticas, ajustes de pontos e auditoria. |
| `/ranking` **Ranking público** | qualquer pessoa (desativável) | Classificação **do mês em curso**, pensada para ficar aberta num ecrã da secção. Atualiza-se a cada minuto. |
| `/login` | — | Entrar e criar conta (o registo pode ser desligado). |

Outros pormenores:
- Interface em português de Portugal, com tema escuro, adaptada a desktop, tablet e telemóvel.
- Nome, subtítulo, rodapé, logótipo e imagem do `/ranking` configuráveis em **Admin → Personalização** (ver [Personalização](#personalização)).
- Modo para daltonismo (botão ◐ no menu).
- Os administradores não têm o separador "Jogar" e entram diretamente no painel.

## Instalação

Requisito comum: **Node.js 22.9 ou superior** (recomendado: 24 LTS), ou Docker.

### Windows (produção)

É a forma recomendada para uma máquina Windows. A aplicação corre como **tarefa do Windows**: arranca com o sistema, reinicia se falhar e faz um **backup diário**. O guia completo, com resolução de problemas, está em **[INSTALACAO-WINDOWS.md](INSTALACAO-WINDOWS.md)**.

Resumo, num PowerShell **como Administrador**:

```powershell
# 1. Instalar o Node.js 24 LTS (https://nodejs.org) e abrir uma NOVA janela do PowerShell

# 2. Obter o código para uma pasta fixa
git clone https://github.com/bmpontes/FOR_Wordle_League.git C:\WordleLeague
#    (sem git: descarregar o ZIP do GitHub em "Code → Download ZIP" e extrair para C:\WordleLeague)

# 3. Instalar (dependências, .env, administrador, firewall, tarefas de arranque e backup)
cd C:\WordleLeague
powershell -ExecutionPolicy Bypass -File .\windows\instalar.ps1
```

No fim, abra `http://<nome-da-máquina>:3000`, entre como administrador e importe as listas de palavras.

| Ação | Comando (na pasta da aplicação) |
|---|---|
| Estado / registo | `powershell -ExecutionPolicy Bypass -File .\windows\servico.ps1 -Acao estado` (ou `-Acao registo`) |
| Parar / iniciar / reiniciar | `... servico.ps1 -Acao parar` · `iniciar` · `reiniciar` (como Administrador) |
| Backup manual | `powershell -ExecutionPolicy Bypass -File .\windows\backup.ps1` |
| Atualizar | ver [Atualizações](#atualizar-para-uma-nova-versão) |
| Desinstalar (mantém os dados) | `powershell -ExecutionPolicy Bypass -File .\windows\desinstalar.ps1` |

> O PowerShell pode recusar `npm` com "a execução de scripts está desativada". Nesse caso use `npm.cmd` (por exemplo `npm.cmd run create-admin`) ou chame o Node diretamente: `node --env-file-if-exists=.env scripts\create-admin.js`.

### Linux com Docker

Requisitos: Docker Engine 24+ com Docker Compose v2.24+.

```bash
git clone https://github.com/bmpontes/FOR_Wordle_League.git
cd FOR_Wordle_League
cp .env.example .env          # editar: ADMIN_USERNAME / ADMIN_PASSWORD (ver abaixo), APP_PORT
docker compose up -d --build
docker compose logs -f app
```

Os dados (base SQLite, segredo de sessão e backups) ficam no volume **`forense-wordle-league_wordle-data`**, montado em `/app/data`, e sobrevivem a `docker compose down` e a reconstruções. **Não use `docker compose down -v`**, porque apaga o volume.

Opcionalmente, pode usar o Nginx como reverse proxy (HTTPS): `docker compose --profile proxy up -d --build`. Veja [nginx/nginx.conf](nginx/nginx.conf) e defina `TRUST_PROXY=1` e `COOKIE_SECURE=true` no `.env`.

### Desenvolvimento local

```bash
npm ci
cp .env.example .env          # para desenvolvimento: NODE_ENV=development
npm run create-admin
npm run dev                   # http://localhost:3000, reinicia ao alterar ficheiros
npm test
```

Os scripts `npm` carregam o `.env` automaticamente (`node --env-file-if-exists=.env`). Os módulos nativos (`better-sqlite3` 12.x e `argon2`) têm binários pré-compilados para Windows, Linux e macOS, por isso não é preciso compilador.

## Primeiro administrador

O código não tem credenciais predefinidas. Há três formas de criar o primeiro administrador:

1. **Interativo (recomendado):** o `windows\instalar.ps1` pergunta durante a instalação. Também pode correr:
   ```bash
   npm run create-admin                                    # ou: node --env-file-if-exists=.env scripts/create-admin.js
   docker compose exec -it app node scripts/create-admin.js
   ```
   A password não aparece no ecrã. O mesmo comando cria administradores adicionais.
2. **Variáveis de ambiente:** defina `ADMIN_USERNAME`, `ADMIN_PASSWORD` e opcionalmente `ADMIN_DISPLAY_NAME` no `.env`. A conta é criada no arranque se ainda não houver nenhum administrador ativo. **Depois apague `ADMIN_PASSWORD` do `.env`.**
3. **No painel:** um administrador cria outros em **Admin → Utilizadores**.

Regras das contas:
- nome de utilizador com 3 a 32 caracteres (`a-z 0-9 . _ -`), único;
- password com pelo menos 10 caracteres, sem conter o nome de utilizador, guardada com **Argon2id**;
- depois de 5 passwords erradas, a conta fica bloqueada 15 minutos (reiniciar a aplicação limpa o bloqueio).

**Esqueceu-se da password de administrador?** Crie outro administrador com `create-admin`, entre com ele e use **Admin → Utilizadores → Redefinir password**.

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

> **Guarde as listas reais fora do repositório.** A pasta [listas/](listas/LEIA-ME.md) existe para isso e o conteúdo está no `.gitignore`. **Nunca** publique a lista de palavras secretas.

**Fontes de listas de palavras aceites (inglês):**
- [ENABLE](https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt): domínio público.
- [lista de tentativas do Wordle](https://github.com/tabatkins/wordle-list).

Use estas fontes **só** como palavras aceites, nunca como secretas: têm muitas palavras obscuras.

## Personalização

Tudo se configura em **Admin → Personalização** e aplica-se a todas as páginas (cabeçalho, login, títulos do separador, ícone do browser, rodapé e `/ranking`):

| Opção | Omissão | Notas |
|---|---|---|
| Nome do jogo | `Wordle League` | 2 a 40 caracteres. |
| Subtítulo | `Desafio diário de palavras` | Opcional (vazio = não aparece). |
| Rodapé | `Uso interno` | Opcional. |
| Logótipo | "W" neutro | PNG, JPEG ou WEBP, de preferência quadrado, até 2 MB. Opção para o recortar em círculo. |
| Imagem do `/ranking` | — | Opcional: imagem grande (ao alto) do lado direito do ranking público. Sem ela, é usado o logótipo com brilho sobre um fundo neutro. |

As imagens são guardadas **na base de dados** (tabela `brand_assets`), por isso entram nos backups automáticos e sobrevivem a atualizações. Por segurança, o tipo é verificado pelo conteúdo do ficheiro e **não são aceites SVG** (podem conter scripts).

## Configuração

### Variáveis de ambiente (`.env`)

| Variável | Omissão | Descrição |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Porta e interface do servidor. |
| `APP_PORT` | `3000` | Porta publicada no anfitrião (só Docker). |
| `DATA_DIR` / `DB_FILE` | `./data` / `$DATA_DIR/wordle.sqlite` | Dados persistentes e base SQLite. |
| `APP_TIMEZONE` | `Europe/Lisbon` | Fuso do desafio diário e do período de jogo. |
| `SESSION_SECRET` | *(gerado)* | Mínimo de 32 caracteres. Se ficar vazio, é gerado e guardado em `$DATA_DIR/.session_secret`. |
| `SESSION_MAX_AGE_HOURS` | `12` | Duração da sessão (renovada com a atividade). |
| `COOKIE_SECURE` | `false` | `true` quando a aplicação é servida por HTTPS. |
| `TRUST_PROXY` | `0` | `1` atrás de um reverse proxy. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | `5` / `15` | Bloqueio por falhas de login (por conta; por IP, o limite é 4×). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY_NAME` | — | Administrador inicial (ver acima). |
| `NODE_ENV` | `production` | Ambiente de execução. |
| `LOG_REQUESTS` | `true` | Regista os pedidos à API (o instalador do Windows desliga-o). |

### Parâmetros do jogo (**Admin → Parâmetros**)

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
| Ranking público (`/ranking`) | ativo |

As alterações ficam na auditoria. O tamanho das palavras, as tentativas e a política de acentos aplicam-se a partir do desafio seguinte. **Os pontos já atribuídos nunca são recalculados.**

## Regras e pontuação

Os jogadores têm a explicação completa na página **/regras**, gerada a partir dos parâmetros. Em resumo:

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

## Operação: backups, restauro e atualizações

### Backups

O backup usa a API de backup do SQLite, por isso é seguro com a aplicação a correr.

| | Windows | Docker | Node |
|---|---|---|---|
| Automático | diário às 03:00, guarda 30 dias em `data\backups` | — (agende com cron) | — |
| Manual | `.\windows\backup.ps1` (`-CopiarPara \\servidor\partilha`) | `docker compose exec app node scripts/backup.js` | `npm run backup` |

Guarde também cópias **fora da máquina**.

### Restauro

A aplicação **tem de estar parada**.

```powershell
# Windows
.\windows\servico.ps1 -Acao parar
node scripts\restore.js data\backups\wordle-AAAAMMDD-HHMMSS.sqlite --yes
.\windows\servico.ps1 -Acao iniciar
```
```bash
# Docker
docker compose stop app
docker compose cp ./backup.sqlite app:/app/data/backups/restaurar.sqlite
docker compose run --rm --no-deps app node scripts/restore.js /app/data/backups/restaurar.sqlite --yes
docker compose start app
```

O restauro verifica a integridade do backup e guarda a BD atual em `wordle.sqlite.pre-restore-<data>` antes de a substituir.

### Atualizar para uma nova versão

```powershell
# Windows (PowerShell como Administrador)
cd C:\WordleLeague
git pull                       # ou copie os ficheiros novos por cima, SEM apagar data\ nem .env
powershell -ExecutionPolicy Bypass -File .\windows\atualizar.ps1
```
```bash
# Docker
git pull && docker compose up -d --build
```

O `atualizar.ps1` faz um backup, para a aplicação, reinstala as dependências e volta a iniciar. As **migrações da base de dados** (`src/db/migrations/*.sql`) são aplicadas automaticamente no arranque. Depois de atualizar, faça **Ctrl+F5** no browser.

## Segurança

- **Passwords:** guardadas com Argon2id. O login é limitado por conta e por IP e a mensagem de erro é sempre a mesma.
- **Sessões:** ficam no SQLite, com cookie `HttpOnly` e `SameSite=Strict` (`Secure` com HTTPS). A sessão é regenerada no login e as sessões de um utilizador terminam se ele for bloqueado.
- **CSRF:** token em todos os pedidos que alteram dados. A CSP é restritiva (sem scripts inline), há cabeçalhos de segurança (Helmet) e só se usam *prepared statements*.
- **Palavra secreta:**
  - nunca é enviada antes do fim do jogo do próprio utilizador;
  - nem o administrador vê a palavra do dia no painel;
  - a ordem de seleção depende de uma semente secreta guardada na BD.
- **Integridade:** triggers na BD impedem alterar ou apagar pontos, tentativas, resultados concluídos e a auditoria.
- **Segredos:** o `.env`, os dados e as listas reais estão no `.gitignore`. **Nunca os publique.**

## Testes

```bash
npm ci
npm test
```

São 69 testes automatizados (`node:test` + `supertest`) com bases de dados temporárias. Cobrem:
- jogo: avaliação de letras, letras repetidas, acentos, palavras inválidas, limite de tentativas, vitória e derrota;
- pontuação: pontos, streaks, bónus de pódio e prevenção de pontos duplicados;
- desafio diário: palavra consistente, mudança à meia-noite de Lisboa (incluindo mudanças de hora), período de jogo e importação de listas;
- segurança: isolamento entre utilizadores, CSRF, limitação de logins, bloqueio de contas e proteção da palavra secreta;
- dados: personalização (incluindo a recusa de imagens disfarçadas), ranking público, regras, persistência após reinício e **migrações sobre bases de dados com dados** de versões anteriores.

## Arquitetura

```
src/
  server.js            arranque: migrações, admin inicial, HTTP, finalização de jogos expirados
  app.js               Express: Helmet/CSP, sessões, CSRF, estáticos, rotas
  config.js            variáveis de ambiente
  context.js           ligação de modelos e serviços (injeção de dependências)
  db/                  ligação SQLite, migrações (migrations/*.sql), store de sessões
  models/              acesso a dados (prepared statements)
  services/            jogo, avaliação, palavra diária, pontuação, streaks, importação,
                       classificações, estatísticas, autenticação, administração, parâmetros
  controllers/ routes/ adaptação HTTP ↔ serviços
  middleware/          autenticação, CSRF, rate limit, erros
  shared/normalize.js  normalização de palavras (a mesma no servidor e no browser)
  utils/               datas/fuso, relógio (injetável nos testes), validação, erros
public/                páginas HTML, CSS, JS e logótipo predefinido (sem dependências externas)
scripts/               create-admin, migrate, backup, restore
windows/               instalação e operação no Windows (PowerShell)
test/                  testes automatizados
examples/              ficheiros de exemplo de importação
listas/                listas reais (só local, ignoradas pelo git)
docs/DECISOES.md       decisões técnicas e limitações
Dockerfile, docker-compose.yml, nginx/   implementação alternativa com Docker
```

**Base de dados:** SQLite em modo WAL. As tabelas principais são `users`, `daily_challenges`, `guesses`, `daily_results`, `word_bank`, `accepted_words`, `seasons`, `point_transactions` (livro de pontos), `settings`, `brand_assets` (imagens de personalização), `audit_log`, `word_imports` e `sessions`.

**Alterar o esquema:** crie um ficheiro novo, por exemplo `005_descricao.sql`. Nunca edite uma migração já aplicada.

## API

Todos os pedidos que alteram dados exigem o cabeçalho `X-CSRF-Token`, devolvido por `/api/auth/session` e pelo login.

| Rota | Acesso | Descrição |
|---|---|---|
| `GET /api/health` | público | Estado do serviço. |
| `GET /api/brand` · `GET /brand/logo` · `GET /brand/ranking` | público | Personalização (nome, textos e imagens). |
| `GET /api/public/leaderboard` | público (desativável) | Classificação do mês em curso (`/ranking`). |
| `GET /api/auth/session` · `POST /api/auth/login` · `register` · `logout` · `password` | — | Autenticação. |
| `GET /api/game/today` · `POST /api/game/guess` | sessão | Estado do jogo, período de jogo e tentativa. |
| `GET /api/leaderboard/daily?date=` · `monthly?season=AAAA-MM` · `alltime` · `seasons` | sessão | Classificações. |
| `GET /api/profile/me` · `GET /api/rules` | sessão | Perfil e regras atuais. |
| `/api/admin/…` (`status`, `stats`, `users`, `settings`, `words`, `points`, `brand`, `audit`) | administrador | Painel de administração. |

## Decisões técnicas e limitações

Ver **[docs/DECISOES.md](docs/DECISOES.md)**: estratégia de seleção da palavra, política de acentos, definição de streak, bónus, período de jogo e limitações conhecidas (por exemplo, a aplicação pressupõe uma única instância).

## Licença

Projeto criado para uso interno de uma equipa. Ainda não foi definida nenhuma licença de distribuição.
