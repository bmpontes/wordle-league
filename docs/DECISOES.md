# Decisões técnicas e limitações conhecidas

Quando a especificação não definia um ponto, foi escolhida a solução mais simples e segura. Cada uma dessas escolhas está registada aqui.

## Decisões técnicas

### Arquitetura (versão 2: GitHub Pages + Supabase)
- **Sem servidor próprio.** O site é estático (HTML/CSS/JS sem frameworks, uma página por ecrã) e está no GitHub Pages. Toda a lógica que estava no servidor Node.js passou para **funções PostgreSQL** no Supabase (`supabase/1-esquema.sql`), chamadas por RPC.
- **As páginas não mudaram de contrato.** Continuam a pedir os mesmos endereços (`/api/game/today`, `/api/admin/users`, …); o `js/api.js` traduz cada um para a função, o Auth ou o Storage do Supabase. Assim a interface da versão 1.x foi reaproveitada quase sem alterações.
- **Esquema privado `wl`.** As tabelas não estão no esquema `public`, que é o exposto pela API do Supabase. Têm RLS ativo e nenhuma permissão para os papéis `anon`/`authenticated`; só as funções `SECURITY DEFINER` (com `search_path` fixo) lhes acedem.
- **Relógio injetável:** `wl.now()` usa a hora real, mas os testes podem fixá-la (`wl.fake_now`), para testar a meia-noite e o período de jogo sem mexer no relógio.
- **Testes** num PostgreSQL 17 em memória (PGlite), com uma imitação mínima do Supabase (esquema `auth`, papéis `anon`/`authenticated`).
- **App instalável (PWA):** `manifest.webmanifest`, ícones PNG e um *service worker* que guarda só os ficheiros do site (os dados vêm sempre da rede).

### Segurança
- **Contas no Supabase Auth.** As passwords são guardadas pelo Supabase (bcrypt). Cada conta tem um email interno `<utilizador>@wordle-league.local`; o jogador só vê e escreve o nome de utilizador. O perfil (`wl.profiles`) é criado por um *trigger* em `auth.users`, que valida o nome e respeita o parâmetro de registo.
- **Primeiro administrador:** a primeira conta criada fica administradora (não há credenciais predefinidas).
- **Contas criadas pelo administrador:** o nome é reservado em `wl.pending_signups` (válido 1 hora) e a conta é registada a seguir; é aceite mesmo com o registo público desligado.
- **Bloqueio:** a conta fica `blocked` (todas as funções o verificam, por isso o efeito é imediato), é banida no Supabase Auth e as sessões são apagadas.
- **Sessões:** *tokens* JWT do Supabase guardados no browser (`localStorage`), renovados automaticamente. Não há cookies, por isso não há CSRF.
- **XSS:** o frontend nunca usa `innerHTML` com dados (usa `textContent` e `createElement`). A CSP (em `<meta>`) só permite scripts do próprio site e ligações ao Supabase, e os nomes de apresentação não aceitam `<` nem `>`.
- **SQL injection:** as funções usam parâmetros; o SQL dinâmico só existe na instalação, com `format('%I')`.
- **Limitação de logins:** fica a cargo do Supabase Auth (limites por IP). A mensagem de erro é sempre a mesma, para não revelar se a conta existe.
- **Proteção da palavra secreta:**
  - a validação e a avaliação são feitas só na base de dados;
  - a solução só é incluída na resposta depois de o jogo **desse** utilizador terminar;
  - o painel de administração só mostra palavras de **dias anteriores**;
  - a ordem de seleção depende de uma semente secreta guardada na BD, que nunca é exposta.

### Palavra diária
- **Seleção determinística sem repetições.** Os candidatos com o tamanho configurado são ordenados por `SHA-256(semente:ciclo:palavra)` e é escolhido o primeiro ainda não usado. A ordem não depende da ordem do ficheiro importado (que pode estar por ordem alfabética), não é adivinhável sem a semente e mantém-se igual entre reinícios.
- **Criação no primeiro pedido do dia.** É serializada com um *advisory lock* e `UNIQUE(challenge_date)`. A palavra é **copiada** para `daily_challenges`, para que o histórico se mantenha se a lista for substituída. Um dia em que ninguém joga não gasta nenhuma palavra.
- **Lista esgotada:** devolve um erro controlado (HTTP 503 com mensagem) e mostra um aviso no painel. Só reutiliza palavras com `recycle_words` ativo; nesse caso escolhe as menos usadas, com uma ordem nova em cada ciclo.
- **Parâmetros fixos por desafio.** O tamanho, o número de tentativas e a política de acentos são guardados em cada desafio. Mudar os parâmetros nunca afeta o jogo em curso.

### Palavras e acentos
- **Normalização igual nos dois lados:** `js/normalize.js` no browser e `wl.to_display`/`wl.strip` na base de dados (NFC, maiúsculas; só são válidas as letras `A–Z` e `ÁÀÂÃÉÊÍÓÔÕÚÇ`).
- **Modo por omissão `strip`:** a comparação ignora acentos e a cedilha (Ç = C), mas é mostrada a forma original. No modo `strict`, os acentos contam e o teclado virtual mostra as letras acentuadas.
- **As palavras secretas são sempre tentativas válidas**, mesmo que não estejam na lista de aceites.
- **Importação em dois passos.** O ficheiro é analisado no browser do administrador (`js/words-file.js`) e a pré-visualização fica nesse separador. Ao confirmar, a base de dados volta a validar todas as palavras. Substituir uma lista não vazia exige confirmação explícita. O limite é 5 MB por ficheiro e o texto tem de estar em UTF-8; um ficheiro com caracteres de substituição é rejeitado com uma mensagem a explicar.

### Pontuação, streaks e classificações
- **Livro de pontos só de acrescento** (`point_transactions`). Cada ponto tem origem: `game_result`, `streak_bonus`, `first_win_bonus` ou `admin_adjustment`. Triggers SQL impedem `UPDATE` e `DELETE` neste livro, nas tentativas, nos resultados concluídos e na auditoria. Índices únicos parciais garantem no máximo um resultado e um bónus por utilizador e desafio.
- **Bónus de pódio** (tipo `first_win_bonus`, coluna `win_rank`): é atribuído na mesma transação que conclui a vitória. A posição é o número de vitórias já registadas no desafio, por isso uma posição com 0 pontos continua a contar para a ordem. Os índices únicos parciais `uq_points_win_rank(challenge_id, win_rank)` e `uq_points_win_bonus_user(user_id, challenge_id)` impedem posições repetidas e bónus duplicados. Durante a contagem, o desafio fica bloqueado (`FOR UPDATE`), para dois vencedores simultâneos não ficarem com a mesma posição.
- **Período de jogo:** é avaliado sempre na base de dados, na hora de Portugal. Antes da abertura, a palavra do dia ainda não é escolhida. Um "00:00" como hora de fecho significa meia-noite (fim do dia). Os administradores não têm o separador de jogo, mas a API não os impede de jogar.
- **Ajustes administrativos:** um ajuste é sempre um movimento novo, com motivo obrigatório. Fica visível para o utilizador e na auditoria e entra na época do mês em curso.
- **Streak:** são dias **de calendário consecutivos** (hora de Lisboa). Por omissão contam os dias com vitória, como no Wordle; o modo "participação" pode ser escolhido. A streak atual mantém-se até ao fim do dia seguinte, para que o utilizador ainda possa jogar hoje. O bónus é atribuído aos 7, 14, 21… dias, uma vez por marco.
- **Jogos abandonados:** um jogo começado num dia anterior e não terminado passa a `expired` e recebe os pontos de participação. Isto acontece antes de qualquer pedido de jogo, classificação, perfil ou estatística (não há tarefas em segundo plano).
- **Colunas das classificações:**
  - *taxa de sucesso* = vitórias ÷ jogos concluídos no período;
  - *melhor streak* = calculada dentro do período (mensal ou sempre); na classificação diária mostra-se a melhor streak de sempre.
  - Os utilizadores bloqueados não aparecem nas classificações.
- **Épocas mensais:** os registos em `seasons` são criados quando são necessários. Os pontos de um jogo pertencem à época da **data do desafio**, não à hora em que foram registados.
- **Desempate na diária:** primeiro os pontos, depois a vitória, depois menos tentativas e por fim quem terminou primeiro. Nas classificações mensal e de sempre: pontos, vitórias, taxa de sucesso e nome.

### Personalização
- **Textos nos parâmetros, imagens no Storage.** O nome, o subtítulo, o rodapé e o "logótipo redondo" são parâmetros normais (auditados). O logótipo e a imagem do ranking ficam no bucket público `marca` do Supabase Storage; a tabela `wl.brand_assets` guarda qual é o ficheiro atual. Só administradores escrevem no bucket.
- **As páginas são estáticas e genéricas.** O `common.js` chama `get_brand` (público, só textos e caminhos) e preenche os elementos `data-brand`. Cada imagem nova tem um nome novo, por isso a cache nunca mostra a antiga.
- **Uploads seguros:** só PNG, JPEG ou WEBP, com o tipo verificado pelos primeiros bytes e no máximo 2 MB. **Não se aceitam SVG**, que podem conter scripts. Sem logótipo próprio, é usado `img/default-logo.svg`. Com um logótipo próprio em PNG ou JPEG, o `common.js` aponta o `apple-touch-icon` para ele, e o iOS usa-o como ícone da app ao adicioná-la ao ecrã principal; a imagem fica só no Supabase, nunca no repositório. O manifesto (usado pelo Android) é estático e mantém o ícone predefinido (`icons/`).

### Contas
- **O registo está aberto por omissão** (pedido na especificação) e o administrador pode desativá-lo.
- **Não há eliminação de utilizadores**, só bloqueio. Assim preserva-se a integridade dos resultados e da auditoria.
- **Não há recuperação de password por email**, porque os emails das contas são internos. A password é redefinida por um administrador.
- **Apagar contas no painel do Supabase** só funciona para contas que nunca jogaram (os resultados não se apagam); para as outras, use o bloqueio.

## Limitações conhecidas

1. **Plano gratuito do Supabase:** o projeto é pausado ao fim de 7 dias sem uso. O despertador (`.github/workflows/despertador.yml`) faz um pedido por dia; se o GitHub Actions estiver parado, o projeto pode ser pausado (os dados mantêm-se; reativa-se em supabase.com).
2. **Modo sem acentos:** palavras que só diferem nos acentos (por exemplo `PÔR`/`POR`) contam como a mesma palavra. Na seleção diária é usada a primeira por ordem alfabética.
3. **Mudanças de parâmetros:** mudar o tamanho das palavras deixa inutilizadas as listas com outro tamanho até ser importada uma lista nova (o painel avisa). Mudar a política de acentos afeta o que é considerado "palavra já usada".
4. **Streak e indisponibilidade:** se num dia não houver palavra disponível (lista vazia ou esgotada), esse dia não tem desafio e a streak dos utilizadores quebra.
5. **Visibilidade para administradores:** um administrador pode exportar a lista de palavras secretas e, por isso, conhecer os candidatos, mas não a ordem nem a palavra do dia. Quem tiver acesso ao painel do Supabase (SQL Editor) pode ler tudo; proteja essa conta com 2FA.
6. **Sem migração automática da versão 1.x:** os dados do servidor antigo (SQLite) não passam sozinhos, e as passwords (Argon2) não são compatíveis com o Supabase Auth.
7. **Formato dos ficheiros:** só é suportado UTF-8. Os ficheiros em Windows-1252/Latin-1 são rejeitados com uma mensagem explicativa; reconverta-os antes de importar.
8. **Testes da interface:** os testes automáticos cobrem a base de dados e os módulos do browser; a interface foi verificada à mão no simulador local (`npm run serve`).
