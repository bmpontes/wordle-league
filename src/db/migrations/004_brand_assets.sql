-- 004_brand_assets: imagens de personalização (logótipo e imagem da página /ranking).
-- Ficam na base de dados para entrarem automaticamente nos backups.

CREATE TABLE brand_assets (
  kind        TEXT    PRIMARY KEY CHECK (kind IN ('logo', 'ranking')),
  mime        TEXT    NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data        BLOB    NOT NULL,
  size        INTEGER NOT NULL CHECK (size > 0),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  INTEGER REFERENCES users(id)
);
