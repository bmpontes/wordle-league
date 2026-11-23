// Configuração da ligação ao Supabase (ver COMO-INSTALAR.md).
// Copie de Supabase → Project Settings → API: o "Project URL" e a chave pública
// ("publishable" / "anon"). Esta chave pode ficar pública: sem sessão iniciada não dá
// acesso a nada, e todas as regras são verificadas na base de dados.
window.WL_CONFIG = {
  SUPABASE_URL: 'https://xradjthgxmuspplhrgxk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_9fETfD4ShXLjiGTwov6zkQ_U6XASY54',
  // Domínio do email interno de cada conta (os jogadores só veem o nome de utilizador).
  // Não mudar depois de haver contas criadas.
  EMAIL_DOMAIN: 'wordle-league.local',
};
