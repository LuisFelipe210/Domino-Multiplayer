import { WebSocket } from 'ws';
import { redisClient } from '../config/redis';
import { AuthenticatedWebSocket } from '../types';

/**
 * Envia uma mensagem de erro padronizada para um cliente específico.
 * Esta função continua a precisar do 'ws' porque um erro é, geralmente, uma resposta direta
 * a uma ação específica e imediata daquele cliente.
 */
export const sendError = (ws: AuthenticatedWebSocket, message: string) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERRO', message }));
  }
};

/**
 * Envia uma carga de dados para um jogador específico, usando o sistema Pub/Sub.
 * @param userId O ID do utilizador alvo.
 * @param payload O objeto de dados a ser enviado.
 */
export const sendToPlayer = (userId: string, payload: object) => {
  redisClient.publish('game-events', JSON.stringify({ targetUserId: userId, payload }));
};

/**
 * Transmite uma carga de dados para todos os jogadores numa sala, usando o sistema Pub/Sub.
 * @param roomId O ID da sala.
 * @param payload O objeto de dados a ser enviado.
 */
export const broadcastToRoom = (roomId: string, payload: object) => {
  redisClient.publish('game-events', JSON.stringify({ roomId, payload }));
};