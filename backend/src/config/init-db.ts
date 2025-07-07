// backend/src/config/init-db.ts
import { pool } from './database';

const createUsersTableQuery = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);`;

const createMatchHistoryTableQuery = `
CREATE TABLE IF NOT EXISTS match_history (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(255) NOT NULL,
    winner_id INTEGER,
    winner_username VARCHAR(50) NOT NULL,
    players JSONB NOT NULL,
    played_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_winner
        FOREIGN KEY(winner_id) 
        REFERENCES users(id)
        ON DELETE SET NULL
);`;

export const initDatabase = async () => {
    const client = await pool.connect();
    try {
        const serverId = process.env.SERVER_ID || 'server';
        console.log(`[${serverId}] Initializing database...`);
        
        await client.query(createUsersTableQuery);
        console.log(`[${serverId}] Table "users" is ready.`);
        
        await client.query(createMatchHistoryTableQuery);
        console.log(`[${serverId}] Table "match_history" is ready.`);
        
        console.log(`[${serverId}] Database initialization complete.`);
    } catch (error)
    {
        console.error(`[${process.env.SERVER_ID || 'server'}] Error initializing database:`, error);
        throw error;
    } finally {
        client.release();
    }
};