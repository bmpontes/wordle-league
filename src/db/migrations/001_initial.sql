-- 001_initial: esquema inicial da Forense Wordle League.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE
                         CHECK (length(username) BETWEEN 3 AND 32),
  display_name   TEXT    NOT NULL CHECK (length(display_name) BETWEEN 2 AND 40),
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at  TEXT
);

-- Parâmetros do jogo (valores JSON). Os valores por omissão vivem no código.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  INTEGER REFERENCES users(id)
);

-- Registo das importações de listas de palavras.
CREATE TABLE word_imports (
  id               INTEGER PRIMARY KEY,
  list_type        TEXT    NOT NULL CHECK (list_type IN ('secret', 'accepted')),
  filename         TEXT,
  mode             TEXT    NOT NULL CHECK (mode IN ('replace', 'append')),
  valid_count      INTEGER NOT NULL,
  invalid_count    INTEGER NOT NULL,
  duplicate_count  INTEGER NOT NULL,
  inserted_count   INTEGER NOT NULL,
  imported_by      INTEGER NOT NULL REFERENCES users(id),
  imported_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Palavras secretas (candidatas a palavra do dia).
CREATE TABLE word_bank (
  id          INTEGER PRIMARY KEY,
  word        TEXT    NOT NULL UNIQUE,      -- forma de apresentação (NFC, maiúsculas)
  word_plain  TEXT    NOT NULL,             -- sem acentos
  length      INTEGER NOT NULL CHECK (length > 0),
  import_id   INTEGER REFERENCES word_imports(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_word_bank_plain ON word_bank(word_plain);
CREATE INDEX idx_word_bank_length ON word_bank(length);

-- Palavras aceites nas tentativas (lista de validação).
CREATE TABLE accepted_words (
  id          INTEGER PRIMARY KEY,
  word        TEXT    NOT NULL UNIQUE,
  word_plain  TEXT    NOT NULL,
  length      INTEGER NOT NULL CHECK (length > 0),
  import_id   INTEGER REFERENCES word_imports(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_accepted_plain ON accepted_words(word_plain);

-- Épocas mensais (leaderboard mensal + histórico).
CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  starts_on   TEXT NOT NULL,
  ends_on     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Um único desafio por data. A palavra é copiada para o desafio, para que o
-- histórico se mantenha mesmo que a lista de palavras seja substituída.
CREATE TABLE daily_challenges (
  id              INTEGER PRIMARY KEY,
  challenge_date  TEXT    NOT NULL UNIQUE CHECK (challenge_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  season_id       INTEGER NOT NULL REFERENCES seasons(id),
  word_bank_id    INTEGER REFERENCES word_bank(id) ON DELETE SET NULL,
  word            TEXT    NOT NULL,
  word_plain      TEXT    NOT NULL,
  word_length     INTEGER NOT NULL CHECK (word_length > 0),
  max_attempts    INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  accent_mode     TEXT    NOT NULL CHECK (accent_mode IN ('strip', 'strict')),
  cycle           INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_challenges_season ON daily_challenges(season_id);
CREATE INDEX idx_challenges_plain ON daily_challenges(word_plain);

-- Estado/resultado de cada utilizador em cada desafio (um por par).
CREATE TABLE daily_results (
  id             INTEGER PRIMARY KEY,
  challenge_id   INTEGER NOT NULL REFERENCES daily_challenges(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  status         TEXT    NOT NULL DEFAULT 'in_progress'
                         CHECK (status IN ('in_progress', 'won', 'lost', 'expired')),
  attempts_used  INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
  points         INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at    TEXT,
  UNIQUE (challenge_id, user_id),
  CHECK ((status = 'in_progress') = (finished_at IS NULL))
);
CREATE INDEX idx_results_user ON daily_results(user_id);
CREATE INDEX idx_results_status ON daily_results(status);

-- Um resultado concluído não pode voltar a "em curso" nem mudar de desfecho.
CREATE TRIGGER trg_results_immutable_when_finished
BEFORE UPDATE ON daily_results
WHEN OLD.status <> 'in_progress'
BEGIN
  SELECT RAISE(ABORT, 'Resultado concluído não pode ser alterado.');
END;

CREATE TRIGGER trg_results_no_delete
BEFORE DELETE ON daily_results
BEGIN
  SELECT RAISE(ABORT, 'Resultados não podem ser apagados.');
END;

CREATE TABLE guesses (
  id              INTEGER PRIMARY KEY,
  result_id       INTEGER NOT NULL REFERENCES daily_results(id),
  challenge_id    INTEGER NOT NULL REFERENCES daily_challenges(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  attempt_number  INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 10),
  guess           TEXT    NOT NULL,
  pattern         TEXT    NOT NULL CHECK (pattern GLOB '[CPA]*'),  -- C=correta, P=presente, A=ausente
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (result_id, attempt_number)
);
CREATE INDEX idx_guesses_user_challenge ON guesses(user_id, challenge_id);

CREATE TRIGGER trg_guesses_append_only_u BEFORE UPDATE ON guesses
BEGIN SELECT RAISE(ABORT, 'Tentativas não podem ser alteradas.'); END;
CREATE TRIGGER trg_guesses_append_only_d BEFORE DELETE ON guesses
BEGIN SELECT RAISE(ABORT, 'Tentativas não podem ser apagadas.'); END;

-- Livro de pontos: cada ponto atribuído tem um evento de origem.
-- A pontuação de qualquer utilizador é a soma destas linhas.
CREATE TABLE point_transactions (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  season_id      INTEGER NOT NULL REFERENCES seasons(id),
  challenge_id   INTEGER REFERENCES daily_challenges(id),
  result_id      INTEGER REFERENCES daily_results(id),
  type           TEXT    NOT NULL CHECK (type IN ('game_result', 'streak_bonus', 'admin_adjustment')),
  points         INTEGER NOT NULL,
  streak_length  INTEGER,
  reason         TEXT    NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (type = 'admin_adjustment' OR challenge_id IS NOT NULL),
  CHECK (type <> 'admin_adjustment' OR created_by IS NOT NULL)
);
-- Prevenção de duplicação: um resultado e no máximo um bónus por desafio/utilizador.
CREATE UNIQUE INDEX uq_points_game_result ON point_transactions(user_id, challenge_id)
  WHERE type = 'game_result';
CREATE UNIQUE INDEX uq_points_streak_bonus ON point_transactions(user_id, challenge_id)
  WHERE type = 'streak_bonus';
CREATE INDEX idx_points_user ON point_transactions(user_id);
CREATE INDEX idx_points_season ON point_transactions(season_id);

-- O livro de pontos é só de acrescento: correções fazem-se com novos movimentos.
CREATE TRIGGER trg_points_append_only_u BEFORE UPDATE ON point_transactions
BEGIN SELECT RAISE(ABORT, 'Movimentos de pontos não podem ser alterados.'); END;
CREATE TRIGGER trg_points_append_only_d BEFORE DELETE ON point_transactions
BEGIN SELECT RAISE(ABORT, 'Movimentos de pontos não podem ser apagados.'); END;

-- Auditoria das ações administrativas.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  target      TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TRIGGER trg_audit_append_only_u BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Registos de auditoria não podem ser alterados.'); END;
CREATE TRIGGER trg_audit_append_only_d BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Registos de auditoria não podem ser apagados.'); END;

-- Sessões HTTP (persistem entre reinícios).
CREATE TABLE sessions (
  sid      TEXT PRIMARY KEY,
  sess     TEXT    NOT NULL,
  expires  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires);
