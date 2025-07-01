// backend/src/websockets/websocketServer.ts
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { redisClient, subscriber } from '../config/redis';
import { handleGameMessage, startGame } from './gameHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
const SERVER_ID = process.env.SERVER_ID || 'default-server';
const PLAYERS_TO_START_GAME = 2;

const wss = new WebSocketServer({ noServer: true });

// Mapas para gerir clientes e salas NESTA instância de servidor
const clientsByUserId = new Map<string, WebSocket>();
const activeRooms = new Map<string, Set<WebSocket>>();

export function initWebSocketServer(server: http.Server) {
    // Iniciar o listener de Pub/Sub para receber eventos de jogo
    subscriber.subscribe('game-events', (message) => {
        try {
            const { roomId, targetUserId, payload } = JSON.parse(message);
            
            if (targetUserId) { // Mensagem para um utilizador específico
                const client = clientsByUserId.get(String(targetUserId));
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            } else if (roomId) { // Mensagem para uma sala inteira
                const room = activeRooms.get(roomId);
                room?.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(payload));
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar mensagem do Pub/Sub:', error);
        }
    });

    wss.on('connection', async (ws: WebSocket, request, user, pathname) => {
        (ws as any).user = user;
        clientsByUserId.set(String(user.userId), ws); 
        
        const roomId = pathname.split('/').pop()!;
        if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, new Set());
        }
        activeRooms.get(roomId)!.add(ws);
        
        // Adiciona o jogador à sala no Redis e verifica se o jogo deve começar
        await redisClient.sAdd(`room:players:${roomId}`, String(user.userId));
        const playerCount = await redisClient.sCard(`room:players:${roomId}`);
        
        console.log(`[${SERVER_ID}] Utilizador ${user.username} conectou-se à sala de jogo ${roomId}. Jogadores: ${playerCount}`);
        
        if (playerCount === PLAYERS_TO_START_GAME) {
            await redisClient.hSet(`room:${roomId}`, 'status', 'playing');
            await startGame(roomId);
        }

        ws.on('message', (message) => {
            let data;
            try { data = JSON.parse(message.toString()); } catch (e) { return; }
            
            // Todas as mensagens aqui são de jogo, então chamamos diretamente o gameHandler
            handleGameMessage(ws, data, roomId);
        });

        ws.on('close', async () => {
             clientsByUserId.delete(String(user.userId));
             const room = activeRooms.get(roomId);
             if (room) {
                 room.delete(ws);
                 await redisClient.sRem(`room:players:${roomId}`, String(user.userId));
                 if (room.size === 0) {
                     activeRooms.delete(roomId);
                     // Lógica adicional de limpeza, se necessário
                 }
             }
        });
    });

    server.on('upgrade', (request, socket, head) => {
        const { pathname, query } = url.parse(request.url!, true);
        const token = query.token as string;

        // O upgrade agora só acontece para as rotas de JOGO
        if (pathname?.startsWith('/ws/game/')) {
            if (!token) { socket.destroy(); return; }
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request, decoded, pathname);
                });
            } catch (err) {
                socket.destroy();
            }
        } else {
            // Recusa qualquer outra tentativa de upgrade que não seja para uma sala de jogo
            socket.destroy();
        }
    });
}
