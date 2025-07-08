import server from './app';
import { pool } from './config/database';
import { PORT, SERVER_ID } from './config/environment';

const startServer = async () => {
    try {
        // Lógica de conexão com Redis foi removida
        await pool.query('SELECT NOW()');
        console.log(`[${SERVER_ID}] Conectado ao PostgreSQL com sucesso.`);

        server.listen(PORT, () => {
            console.log(`Backend server '${SERVER_ID}' iniciado na porta ${PORT}`);
        });
    } catch (error) {
        console.error(`[${SERVER_ID}] FALHA CRÍTICA AO INICIAR O SERVIDOR:`, error);
        process.exit(1);
    }
};

startServer();