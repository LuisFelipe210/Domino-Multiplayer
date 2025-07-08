import * as dotenv from 'dotenv';
dotenv.config();

const getEnvVar = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        console.error(`FALHA CRÍTICA: A variável de ambiente ${name} não está definida.`);
        process.exit(1);
    }
    return value;
};

export const DATABASE_URL = getEnvVar('DATABASE_URL');
export const JWT_SECRET = getEnvVar('JWT_SECRET');
export const PORT = process.env.PORT || '3000';
export const SERVER_ID = process.env.SERVER_ID || 'default-server';

// REDIS_URL foi removido
if (!DATABASE_URL || !JWT_SECRET) {
    console.error("Uma ou mais variáveis de ambiente críticas não foram definidas. A sair.");
    process.exit(1);
}