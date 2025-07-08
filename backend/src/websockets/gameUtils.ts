import { WebSocket } from 'ws';
import { AuthenticatedWebSocket } from '../types';
import { clientsByUserId, roomsByClientId } from './websocketServer';
import { wss } from './serverInstance';

export const sendError = (ws: AuthenticatedWebSocket, message: string) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERRO', message }));
  }
};

export const sendToPlayer = (userId: string, payload: object) => {
  const client = clientsByUserId.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
};

/**
 * Transmite uma carga de dados para todos os jogadores numa sala.
 */
export const broadcastToRoom = (roomId: string, payload: object | ((player: AuthenticatedWebSocket) => object)) => {
  wss.clients.forEach(client => {
    const wsClient = client as AuthenticatedWebSocket;
    if (roomsByClientId.get(wsClient) === roomId && wsClient.readyState === WebSocket.OPEN) {
        const message = typeof payload === 'function' ? payload(wsClient) : payload;
        wsClient.send(JSON.stringify(message));
    }
  });
};

/**
 * NOVO: Transmite uma mensagem para todos os clientes que não estão numa sala (ou seja, estão no lobby).
 */
export const broadcastToLobby = (payload: object) => {
    wss.clients.forEach(client => {
        const wsClient = client as AuthenticatedWebSocket;
        if (!roomsByClientId.get(wsClient) && wsClient.readyState === WebSocket.OPEN) {
            wsClient.send(JSON.stringify(payload));
        }
    });
};