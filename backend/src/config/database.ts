// backend/src/config/database.ts
import pg from 'pg';

// Usar uma exportação nomeada em vez de default
export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});
