import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { redisClient, subscriber } from '../config/redis';
import { startGame, broadcastPublicState, getGameState, saveGameState, getNextTurn, handleLeaveGame } from './gameHandler';
import { handleGameMessage } from './messageHandler';
import { AuthenticatedWebSocket, GameState } from '../types';
import { PLAYERS_TO_START_GAME, LOCK_EXPIRATION, DISCONNECT_TIMEOUT } from '../config/gameConfig';
import { JWT_SECRET, SERVER_ID } from '../config/environment';


const wss = new WebSocketServer({ noServer: true });

const clientsByUserId = new Map<string, AuthenticatedWebSocket>();
const roomsByClientId = new Map<AuthenticatedWebSocket, string>();

const updatePublicRoomCount = async (roomId: string) => {
    const playerCount = await redisClient.sCard(`room:players:${roomId}`);
    const roomData = await redisClient.hGetAll(`room:${roomId}`);
    
    if (roomData.status === 'waiting') {
        const publicRoomDetails = {
            playerCount: playerCount,
            hasPassword: !!roomData.passwordHash
        };
        await redisClient.hSet('public_rooms', roomId, JSON.stringify(publicRoomDetails));
    }
};

const clearDisconnectTimer = (gameState: GameState, userId: string) => {
    if (gameState.disconnectTimers && gameState.disconnectTimers[userId]) {
        clearTimeout(gameState.disconnectTimers[userId]);
        delete gameState.disconnectTimers[userId];
    }
};

export function initWebSocketServer(server: http.Server) {
    subscriber.subscribe('game-events', (message) => {
        try {
            const { roomId, targetUserId, payload } = JSON.parse(message);
            
            if (targetUserId) {
                const client = clientsByUserId.get(String(targetUserId));
                if (client && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            } else if (roomId) {
                wss.clients.forEach(client => {
                    const wsClient = client as AuthenticatedWebSocket;
                    if (roomsByClientId.get(wsClient) === roomId && wsClient.readyState === WebSocket.OPEN) {
                        wsClient.send(JSON.stringify(payload));
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar mensagem do Pub/Sub:', error);
        }
    });

    wss.on('connection', async (ws: AuthenticatedWebSocket, request, user, pathname) => {
        ws.user = user;
        const userId = String(user.userId);
        const roomId = pathname.split('/').pop()!;

        clientsByUserId.set(userId, ws); 
        roomsByClientId.set(ws, roomId);
        console.log(`[${SERVER_ID}] Utilizador ID ${userId} conectou-se. Sala: ${roomId}. Clientes nesta instância: ${clientsByUserId.size}`);

        const gameState = await getGameState(roomId);
        if (gameState) {
            const playerInGame = gameState.players.find(p => p.id === userId);
            if (playerInGame && playerInGame.disconnectedSince) {
                console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} reconectou-se ao JOGO ${roomId}.`);
                delete playerInGame.disconnectedSince;
                clearDisconnectTimer(gameState, userId);

                await saveGameState(roomId, gameState);
                broadcastPublicState(roomId, gameState, 'ESTADO_ATUALIZADO');

                sendToPlayer(userId, {
                    type: 'JOGO_INICIADO',
                    myId: userId,
                    yourHand: gameState.hands[userId],
                    board: gameState.board,
                    turn: gameState.turn,
                    players: gameState.players,
                    activeEnds: gameState.activeEnds,
                });
                return; 
            }
        }
        
        await redisClient.sAdd(`room:players:${roomId}`, userId);
        await redisClient.hSet(`room:${roomId}`, 'playerCount', (await redisClient.sCard(`room:players:${roomId}`)).toString());
        await redisClient.set(`user:${userId}:username`, user.username, { EX: 86400 });
        
        await updatePublicRoomCount(roomId);
        
        const totalPlayersInRoom = await redisClient.sCard(`room:players:${roomId}`);
        console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} entrou no LOBBY da sala ${roomId}. Jogadores na sala: ${totalPlayersInRoom}`);
        
        if (totalPlayersInRoom >= PLAYERS_TO_START_GAME) {
            const roomStatus = await redisClient.hGet(`room:${roomId}`, 'status');
            if (roomStatus !== 'playing') {
                const lock = await redisClient.set(`lock:start_game:${roomId}`, SERVER_ID, { NX: true, EX: LOCK_EXPIRATION });
                if (lock) {
                    console.log(`[${SERVER_ID}] Lock adquirido. A iniciar o jogo na sala ${roomId}...`);
                    await redisClient.hSet(`room:${roomId}`, 'status', 'playing');
                    await startGame(roomId);
                } else {
                    console.log(`[${SERVER_ID}] Outro servidor já está a processar o início do jogo para a sala ${roomId}.`);
                }
            }
        }

        ws.on('message', (message) => {
            handleGameMessage(ws, message, roomId);
        });

        ws.on('close', async () => {
             clientsByUserId.delete(userId);
             roomsByClientId.delete(ws);
             console.log(`[${SERVER_ID}] Utilizador ID ${userId} desconectou-se. Clientes nesta instância: ${clientsByUserId.size}`);
             
             const currentGameState = await getGameState(roomId);
             if (currentGameState && currentGameState.players.find(p => p.id === userId)) {
                 const player = currentGameState.players.find(p => p.id === userId)!;
                 player.disconnectedSince = Date.now();
                 
                 if (currentGameState.turn === userId) {
                    currentGameState.turn = getNextTurn(userId, currentGameState.players);
                 }

                 const timerId = setTimeout(() => {
                    console.log(`[${SERVER_ID}] Tempo de desconexão para o utilizador ID ${user.userId} expirou. Removendo do jogo ${roomId}.`);
                    getGameState(roomId).then(latestGameState => {
                        if (latestGameState) {
                            handleLeaveGame(ws, latestGameState, roomId, true);
                        }
                    });
                 }, DISCONNECT_TIMEOUT);

                 if (!currentGameState.disconnectTimers) {
                    currentGameState.disconnectTimers = {};
                 }
                 currentGameState.disconnectTimers[userId] = timerId;

                 await saveGameState(roomId, currentGameState);
                 broadcastPublicState(roomId, currentGameState, 'ESTADO_ATUALIZADO');
                 console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} desconectou-se do JOGO ${roomId}. Estado de jogo atualizado.`);
             } else {
                 await redisClient.sRem(`room:players:${roomId}`, userId);
                 await redisClient.hSet(`room:${roomId}`, 'playerCount', (await redisClient.sCard(`room:players:${roomId}`)).toString());
                 await updatePublicRoomCount(roomId);
                 console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} desconectou-se do LOBBY da sala ${roomId}.`);
             }
        });
    });

    server.on('upgrade', (request, socket, head) => {
        const { pathname, query } = url.parse(request.url!, true);
        const token = query.token as string;

        if (pathname?.startsWith('/ws/game/')) {
            if (!token) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request, decoded, pathname);
                });
            } catch (err) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
            }
        } else {
            socket.destroy();
        }
    });
}