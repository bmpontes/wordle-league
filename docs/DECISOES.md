# Decisões técnicas e limitações conhecidas

Quando a especificação não definia um ponto, foi escolhida a solução mais simples e segura. Cada uma dessas escolhas está registada aqui.

## Decisões técnicas

### Arquitetura
- **Express 4 + HTML/CSS/JS sem frameworks.** Uma página HTML por ecrã: jogo, login, classificação, perfil e administração. O backend está dividido em `routes → controllers → services → models`. Os serviços recebem as dependências por injeção (`src/context.js`), o que os torna testáveis sem HTTP.
- **SQLite com `better-sqlite3` (linha 12.x).** É síncrono, tem transações reais e traz binários pré-compilados, por isso não precisa de compilador. A linha 13 deixou de trazer esses binários e foi evitada de propósito. A BD usa modo WAL e `foreign_keys = ON`.
- **Relógio injetável** (`src/utils/clock.js`). Permite testar a mudança à meia-noite sem alterar a hora do sistema.

### Segurança
- **Argon2id** (m=19 MiB, t=2, p=1, a recomendação mínima da OWASP). Os hashes são atualizados automaticamente no login se os parâmetros mudarem.
- **Sessões guardadas no SQLite.** Sobrevivem a reinícios. O cookie `fwl.sid` é `HttpOnly`, `SameSite=Strict` e `Secure` quando `COOKIE_SECURE=true`. A sessão é regenerada no login (contra *session fixation*). As sessões de um utilizador são eliminadas quando este é bloqueado ou quando a password é redefinida.
- **Segredo das sessões:** usa `SESSION_SECRET`. Se não estiver definido, é gerado com `crypto.randomBytes` e guardado em `DATA_DIR/.session_secret` (modo 600). Nunca está no código.
- **CSRF:** token *synchronizer* por sessão, enviado no cabeçalho `X-CSRF-Token` em todos os pedidos não-GET (incluindo o login), e comparado em tempo constante. O cookie `SameSite=Strict` acrescenta uma segunda camada.
- **XSS:** o frontend nunca usa `innerHTML` com dados (usa `textContent` e `createElement`). A CSP é restritiva (`script-src 'self'`, sem inline) e os nomes de apresentação não aceitam `<` nem `>`.
- **SQL injection:** só *prepared statements*. Os nomes de tabelas vêm de uma lista fechada.
- **Limitação de logins:** por conta (5 falhas em 15 min) e por IP (20 em 15 min). A mensagem de erro é sempre a mesma e é verificado um hash fictício quando o utilizador não existe, para não revelar se a conta existe. Há ainda limites genéricos para a API e para as tentativas de jogo (30/min por utilizador).
- **Proteção da palavra secreta:**
  - a avaliação é feita só no servidor;
  - a solução só é incluída na resposta depois de o jogo **desse** utilizador terminar;
  - o painel de administração só mostra palavras de **dias anteriores**;
  - a ordem de seleção depende de uma semente secreta guardada na BD, que nunca é exposta pela API.

### Palavra diária
- **Seleção determinística sem repetições.** Os candidatos com o tamanho configurado são ordenados por `SHA-256(semente:ciclo:palavra)` e é escolhido o primeiro ainda não usado. A ordem não depende da ordem do ficheiro importado (que pode estar por ordem alfabética), não é adivinhável sem a semente e mantém-se igual entre reinícios.
- **Criação no primeiro pedido do dia.** É feita numa transação `IMMEDIATE`, com `UNIQUE(challenge_date)`. A palavra é **copiada** para `daily_challenges`, para que o histórico se mantenha se a lista for substituída. Um dia em que ninguém joga não gasta nenhuma palavra.
- **Lista esgotada:** devolve um erro controlado (HTTP 503 com mensagem) e mostra um aviso no painel. Só reutiliza palavras com `recycle_words` ativo; nesse caso escolhe as menos usadas, com uma ordem nova em cada ciclo.
- **Parâmetros fixos por desafio.** O tamanho, o número de tentativas e a política de acentos são guardados em cada desafio. Mudar os parâmetros nunca afeta o jogo em curso.

### Palavras e acentos
- **Uma única implementação** (`src/shared/normalize.js`) é usada pelo Node e pelo browser (servida em `/shared/normalize.js`).
- **Modo por omissão `strip`:** a comparação ignora acentos e a cedilha (Ç = C), mas é mostrada a forma original. No modo `strict`, os acentos contam e o teclado virtual mostra as letras acentuadas.
- **As palavras secretas são sempre tentativas válidas**, mesmo que não estejam na lista de aceites.
- **Importação em dois passos.** A pré-visualização fica em memória durante 30 minutos e só pode ser usada pelo administrador que a criou. Substituir uma lista não vazia exige `confirmReplace: true`. O limite é 5 MB por ficheiro e o texto tem de estar em UTF-8; um ficheiro com caracteres de substituição é rejeitado com uma mensagem a explicar.

### Pontuação, streaks e classificações
- **Livro de pontos só de acrescento** (`point_transactions`). Cada ponto tem origem: `game_result`, `streak_bonus`, `first_win_bonus` ou `admin_adjustment`. Triggers SQL impedem `UPDATE` e `DELETE` neste livro, nas tentativas, nos resultados concluídos e na auditoria. Índices únicos parciais garantem no máximo um resultado e um bónus por utilizador e desafio.
- **Bónus de pódio** (tipo `first_win_bonus`, coluna `win_rank`): é atribuído na mesma transação que conclui a vitória. A posição é o número de vitórias já registadas no desafio, por isso uma posição com 0 pontos continua a contar para a ordem. Os índices únicos parciais `uq_points_win_rank(challenge_id, win_rank)` e `uq_points_win_bonus_user(user_id, challenge_id)` impedem posições repetidas e bónus duplicados. A migração 002 reconstrói `point_transactions` para aceitar o novo tipo; a 003 acrescenta `win_rank` e converte os bónus já atribuídos em 1.º lugar.
- **Período de jogo:** é avaliado sempre no servidor, na hora de Portugal. Antes da abertura, a palavra do dia ainda não é escolhida. Um "00:00" como hora de fecho significa meia-noite (fim do dia). Os administradores não têm o separador de jogo, mas a API não os impede de jogar.
- **Ajustes administrativos:** um ajuste é sempre um movimento novo, com motivo obrigatório. Fica visível para o utilizador e na auditoria e entra na época do mês em curso.
- **Streak:** são dias **de calendário consecutivos** (hora de Lisboa). Por omissão contam os dias com vitória, como no Wordle; o modo "participação" pode ser escolhido. A streak atual mantém-se até ao fim do dia seguinte, para que o utilizador ainda possa jogar hoje. O bónus é atribuído aos 7, 14, 21… dias, uma vez por marco.
- **Jogos abandonados:** um jogo começado num dia anterior e não terminado passa a `expired` e recebe os pontos de participação. Isto acontece no arranque, a cada 10 minutos e antes de qualquer pedido de jogo.
- **Colunas das classificações:**
  - *taxa de sucesso* = vitórias ÷ jogos concluídos no período;
  - *melhor streak* = calculada dentro do período (mensal ou sempre); na classificação diária mostra-se a melhor streak de sempre.
  - Os utilizadores bloqueados não aparecem nas classificações.
- **Épocas mensais:** os registos em `seasons` são criados quando são necessários. Os pontos de um jogo pertencem à época da **data do desafio**, não à hora em que foram registados.
- **Desempate na diária:** primeiro os pontos, depois a vitória, depois menos tentativas e por fim quem terminou primeiro. Nas classificações mensal e de sempre: pontos, vitórias, taxa de sucesso e nome.

### Contas
- **O registo está aberto por omissão** (pedido na especificação) e o administrador pode desativá-lo.
- **Não há eliminação de utilizadores**, só bloqueio. Assim preserva-se a integridade dos resultados e da auditoria.
- **Não há recuperação de password por email**, porque a aplicação funciona sem Internet. A password é redefinida por um administrador.

## Limitações conhecidas

1. **Uma única instância.** O SQLite, os contadores de *rate limiting* e as pré-visualizações de importação (estes dois em memória) pressupõem um único processo. Para escalar horizontalmente seria preciso um armazenamento partilhado. Para uma secção, uma instância chega e sobra.
2. **Reinício do processo:** apaga os contadores de tentativas de login e as pré-visualizações de importação pendentes. As sessões e os dados não se perdem.
3. **Modo sem acentos:** palavras que só diferem nos acentos (por exemplo `PÔR`/`POR`) contam como a mesma palavra. Na seleção diária é usada a primeira por ordem alfabética.
4. **Mudanças de parâmetros:** mudar o tamanho das palavras deixa inutilizadas as listas com outro tamanho até ser importada uma lista nova (o painel avisa). Mudar a política de acentos afeta o que é considerado "palavra já usada".
5. **Streak e indisponibilidade:** se num dia não houver palavra disponível (lista vazia ou esgotada), esse dia não tem desafio e a streak dos utilizadores quebra.
6. **Visibilidade para administradores:** um administrador pode exportar a lista de palavras secretas e, por isso, conhecer os candidatos, mas não a ordem nem a palavra do dia. Quem tiver acesso direto ao ficheiro da BD pode ler tudo; proteja o volume e os backups.
7. **Fuso horário:** depende do suporte ICU do Node.js. As imagens oficiais do Node e as instalações normais trazem-no; um Node compilado com `small-icu` sem dados de fusos não funcionaria.
8. **Testes da interface:** a interface web não tem testes automatizados em browser. Os testes cobrem os serviços e a API HTTP.
9. **Formato dos ficheiros:** só é suportado UTF-8. Os ficheiros em Windows-1252/Latin-1 são rejeitados com uma mensagem explicativa; reconverta-os antes de importar.
