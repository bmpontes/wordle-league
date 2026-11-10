-- 002_first_win_bonus: novo tipo de movimento "first_win_bonus" (bónus para o
-- primeiro utilizador a acertar no desafio do dia).
-- O SQLite não permite alterar um CHECK, por isso a tabela é reconstruída:
-- todas as linhas são copiadas sem alterações, e os índices e triggers são recriados.
-- (Nenhuma tabela referencia point_transactions; o DROP TABLE não dispara triggers.)

CREATE TABLE point_transactions_new (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  season_id      INTEGER NOT NULL REFERENCES seasons(id),
  challenge_id   INTEGER REFERENCES daily_challenges(id),
  result_id      INTEGER REFERENCES daily_results(id),
  type           TEXT    NOT NULL CHECK (type IN ('game_result', 'streak_bonus', 'first_win_bonus', 'admin_adjustment')),
  points         INTEGER NOT NULL,
  streak_length  INTEGER,
  reason         TEXT    NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (type = 'admin_adjustment' OR challenge_id IS NOT NULL),
  CHECK (type <> 'admin_adjustment' OR created_by IS NOT NULL)
);

INSERT INTO point_transactions_new
  (id, user_id, season_id, challenge_id, result_id, type, points, streak_length, reason, created_by, created_at)
SELECT id, user_id, season_id, challenge_id, result_id, type, points, streak_length, reason, created_by, created_at
  FROM point_transactions;

DROP TABLE point_transactions;
ALTER TABLE point_transactions_new RENAME TO point_transactions;

CREATE UNIQUE INDEX uq_points_game_result ON point_transactions(user_id, challenge_id)
  WHERE type = 'game_result';
CREATE UNIQUE INDEX uq_points_streak_bonus ON point_transactions(user_id, challenge_id)
  WHERE type = 'streak_bonus';
-- Um único bónus de "primeiro a acertar" por desafio (para todos os utilizadores).
CREATE UNIQUE INDEX uq_points_first_win ON point_transactions(challenge_id)
  WHERE type = 'first_win_bonus';
CREATE INDEX idx_points_user ON point_transactions(user_id);
CREATE INDEX idx_points_season ON point_transactions(season_id);

CREATE TRIGGER trg_points_append_only_u BEFORE UPDATE ON point_transactions
BEGIN SELECT RAISE(ABORT, 'Movimentos de pontos não podem ser alterados.'); END;
CREATE TRIGGER trg_points_append_only_d BEFORE DELETE ON point_transactions
BEGIN SELECT RAISE(ABORT, 'Movimentos de pontos não podem ser apagados.'); END;
