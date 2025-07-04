import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Função auxiliar para obter uma variável de ambiente e falhar se não estiver definida.
 * @param name O nome da variável de ambiente.
 * @returns O valor da variável.
 */
const getEnvVar = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        console.error(`FALHA CRÍTICA: A variável de ambiente ${name} não está definida.`);
        process.exit(1);
    }
    return value;
};

// Valida e exporta todas as variáveis de ambiente necessárias para a aplicação.
export const DATABASE_URL = getEnvVar('DATABASE_URL');
export const JWT_SECRET = getEnvVar('JWT_SECRET');
export const PORT = process.env.PORT || '4000'; // PORT pode ter um valor padrão
export const SERVER_ID = process.env.SERVER_ID || 'default-server';
export const REDIS_URL = getEnvVar('REDIS_URL');

// Validação no arranque para garantir que as variáveis críticas existem.
if (!DATABASE_URL || !JWT_SECRET || !REDIS_URL) {
    console.error("Uma ou mais variáveis de ambiente críticas não foram definidas. A sair.");
    process.exit(1);
}