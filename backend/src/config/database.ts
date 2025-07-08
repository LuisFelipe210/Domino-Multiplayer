import pg from 'pg';
import { DATABASE_URL } from './environment';

export const pool = new pg.Pool({
    connectionString: DATABASE_URL,
});
