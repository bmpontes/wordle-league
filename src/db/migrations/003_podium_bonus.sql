-- 003_podium_bonus: o bónus de "primeiro a acertar" passa a bónus de pódio
-- (1.º, 2.º, 3.º… a acertar no desafio do dia). O tipo continua a ser
-- 'first_win_bonus'; a nova coluna win_rank indica a posição.

ALTER TABLE point_transactions ADD COLUMN win_rank INTEGER CHECK (win_rank IS NULL OR win_rank BETWEEN 1 AND 10);

-- Os bónus já atribuídos (um por desafio) correspondem ao 1.º lugar.
-- O livro de pontos é só de acrescento: o trigger é suspenso apenas para esta correção de esquema.
DROP TRIGGER trg_points_append_only_u;
UPDATE point_transactions SET win_rank = 1 WHERE type = 'first_win_bonus';
CREATE TRIGGER trg_points_append_only_u BEFORE UPDATE ON point_transactions
BEGIN SELECT RAISE(ABORT, 'Movimentos de pontos não podem ser alterados.'); END;

-- Uma posição por desafio e, no máximo, um bónus de pódio por utilizador e desafio.
DROP INDEX uq_points_first_win;
CREATE UNIQUE INDEX uq_points_win_rank ON point_transactions(challenge_id, win_rank)
  WHERE type = 'first_win_bonus';
CREATE UNIQUE INDEX uq_points_win_bonus_user ON point_transactions(user_id, challenge_id)
  WHERE type = 'first_win_bonus';
