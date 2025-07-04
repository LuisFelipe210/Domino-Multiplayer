-- Cria a tabela de utilizadores se ela não existir
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cria a tabela de histórico de partidas se ela não existir
CREATE TABLE IF NOT EXISTS match_history (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(255) NOT NULL,
    winner_id INTEGER REFERENCES users(id),
    winner_username VARCHAR(255),
    players JSONB,
    finished_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Adiciona um índice para pesquisas rápidas por nome de utilizador
CREATE INDEX IF NOT EXISTS idx_username ON users(username);