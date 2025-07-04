import server from './app';
import { redisClient, subscriber } from './config/redis';
import { pool } from './config/database';
// Importa as variáveis de ambiente já validadas
import { PORT, SERVER_ID } from './config/environment';

const startServer = async () => {
    const connectWithRetry = async (serviceName: string, connectFn: () => Promise<any>) => {
        const maxRetries = 10;
        const retryDelay = 3000;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await connectFn();
                console.log(`[${SERVER_ID}] Conectado ao ${serviceName} com sucesso.`);
                return;
            } catch (err: any) {
                console.error(`[${SERVER_ID}] Falha ao conectar ao ${serviceName} (tentativa ${i + 1}/${maxRetries}):`, err.message);
                if (i === maxRetries - 1) throw err;
                await new Promise(res => setTimeout(res, retryDelay));
            }
        }
    };

    try {
        await connectWithRetry('Redis Publisher', () => redisClient.connect());
        await connectWithRetry('Redis Subscriber', () => subscriber.connect());
        await connectWithRetry('PostgreSQL', () => pool.query('SELECT NOW()'));

        await redisClient.sAdd('available_game_servers', SERVER_ID);
        console.log(`[${SERVER_ID}] Servidor registado como disponível no Redis.`);

        server.listen(PORT, () => {
            console.log(`Backend server '${SERVER_ID}' iniciado na porta ${PORT}`);
        });
    } catch (error) {
        console.error(`[${SERVER_ID}] FALHA CRÍTICA AO INICIAR O SERVIDOR:`, error);
        process.exit(1);
    }
};

startServer();