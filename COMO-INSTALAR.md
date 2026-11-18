# Wordle League — como pôr a funcionar

A app é uma *web app* (PWA): abre-se no browser e instala-se no iPhone ou Android com ícone no ecrã principal.
O site fica no **GitHub Pages** e os dados no **Supabase**, ambos gratuitos. Não é preciso nenhum computador ligado.

Tempo total: cerca de 15 minutos.

---

## 1. Criar a base de dados (Supabase) — ~8 min

1. Entre em **supabase.com** (pode usar a conta do GitHub) → **New project**.
   - Nome: `wordle-league`; Região: uma da Europa (ex.: *West EU (Ireland)*).
   - Guarde a password da base de dados num sítio seguro (não vai ser precisa no dia a dia).
2. No menu do projeto, abra **SQL Editor** → **New query**, cole **todo** o conteúdo de
   [`supabase/1-esquema.sql`](supabase/1-esquema.sql) e carregue em **Run**.
   Deve aparecer *"Success. No rows returned"*.
3. **Authentication → Sign In / Providers → Email**:
   - **Confirm email**: **desligado** (as contas usam um email interno que não recebe mensagens).
   - **Minimum password length** (se aparecer): `10`.
   - Deixe **Allow new users to sign up** **ligado**: quem pode criar conta é controlado dentro da app
     (**Admin → Parâmetros → Registo de novas contas**), e o administrador também precisa disto para criar contas.
4. **Project Settings → API** (ou *Data API* / *API Keys*): copie
   - o **Project URL** (ex.: `https://abcdefgh.supabase.co`);
   - a chave **publishable** (começa por `sb_publishable_`) ou, em projetos antigos, a **anon public**.

   **Nunca** use a chave *secret* / *service_role*.

> ⚠️ No plano gratuito, o Supabase **pausa o projeto se não for usado durante 7 dias**. O despertador
> (passo 4) evita isso. Se mesmo assim acontecer, os dados não se perdem: entre em supabase.com e carregue em **Restore project**.

## 2. Ligar a app ao Supabase — ~1 min

Edite o [`config.js`](config.js) e cole os dois valores do passo 1.4:

```js
window.WL_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...',
  EMAIL_DOMAIN: 'wordle-league.local',
};
```

Não mude o `EMAIL_DOMAIN` depois de haver contas criadas.

## 3. Publicar o site (GitHub Pages) — ~3 min

1. No GitHub, no repositório: **Settings → General → Danger Zone → Change visibility → Public**
   (o GitHub Pages gratuito só publica repositórios públicos; o código não tem palavras nem dados).
2. **Settings → Pages**: em *Build and deployment*, escolha **Deploy from a branch**, ramo **main**, pasta **/ (root)** → **Save**.
3. Ao fim de 1–2 minutos aparece o endereço, por exemplo `https://<utilizador>.github.io/Wordle_League/`.

## 4. Despertador do Supabase — ~1 min

O workflow [`despertador.yml`](.github/workflows/despertador.yml) já está no repositório e corre todos os dias.
Para confirmar que funciona: **Actions → Despertador Supabase → Run workflow**. Um ✓ verde quer dizer que está tudo bem.
Se falhar, o GitHub envia um email.

## 5. Primeira conta e listas de palavras — ~3 min

1. Abra o endereço do site → **Criar conta**. **A primeira conta criada fica administradora.**
2. Em **Admin → Palavras**, importe:
   - a lista de **palavras secretas** (as palavras do dia — escolha palavras comuns);
   - a lista de **palavras aceites** (todas as palavras válidas nas tentativas; quanto maior, melhor).

   Formatos: `.txt` (uma palavra por linha) ou `.csv` (primeira coluna), em UTF-8. Ver [`examples/`](examples/).
   **Nunca** ponha a lista de palavras secretas no repositório.
3. Em **Admin → Parâmetros** ajuste o horário, os pontos e se o registo fica aberto.
   Para uma liga fechada: crie as contas em **Admin → Utilizadores** e desligue **Registo de novas contas**.
4. Em **Admin → Personalização** mude o nome, o subtítulo e o logótipo, se quiser.

## 6. Instalar no telemóvel

- **iPhone/iPad:** abra o endereço no **Safari** → botão **Partilhar** → **Adicionar ao ecrã principal**.
- **Android:** abra no **Chrome** → menu **⋮** → **Instalar aplicação**.

---

## Segurança — recomendações

- Ative a **verificação em dois passos (2FA)** nas contas do **GitHub** e do **Supabase**.
- Use passwords fortes nas contas de administrador da app.
- Se não quiser que o seu email apareça no histórico público do repositório:
  GitHub → **Settings → Emails → Keep my email addresses private**.

## Atualizar a app mais tarde

- **Ficheiros do site:** basta enviar para o ramo `main`; o GitHub Pages atualiza em 1–2 minutos.
  Aumente a versão em `sw.js` (`wordle-league-vN`) para as apps instaladas atualizarem logo.
- **Base de dados:** se o `supabase/1-esquema.sql` mudar, cole-o de novo no **SQL Editor** e carregue em **Run**.
  Os dados existentes mantêm-se.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "A aplicação ainda não está ligada à base de dados" | O `config.js` ainda tem os campos vazios. |
| "O Supabase exige confirmação por email" ao criar conta | **Confirm email** ainda está ligado (passo 1.3). |
| "Não foi possível criar a conta" | Registo desligado em **Admin → Parâmetros**, ou nome/password inválidos. |
| Tudo dá erro de ligação depois de umas semanas sem uso | O projeto foi pausado: **Restore project** em supabase.com e verifique o despertador. |
| "Ainda não existe uma lista de palavras secretas" | Falta importar a lista em **Admin → Palavras**. |
