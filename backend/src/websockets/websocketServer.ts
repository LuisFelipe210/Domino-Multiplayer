import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';
import { 
    getGameState, 
    saveGameState,
    handleLeaveGame,
    getPublicState,
    processGameLogicResult
} from './gameHandler';
import { handleGameMessage } from './messageHandler';
import { AuthenticatedWebSocket, DecodedToken, GameState } from '../types';
import { MAX_PLAYERS } from '../config/gameConfig';
import { JWT_SECRET, SERVER_ID } from '../config/environment';
import { memoryStore } from './memoryStore';
import { broadcastToRoom, sendToPlayer, sendError } from './gameUtils';
import { setWss } from './serverInstance';

export const clientsByUserId = new Map<string, AuthenticatedWebSocket>();
export const roomsByClientId = new Map<AuthenticatedWebSocket, string>();

const clearDisconnectTimer = (gameState: GameState, userId: string) => {
    if (gameState.disconnectTimers && gameState.disconnectTimers[userId]) {
        clearTimeout(gameState.disconnectTimers[userId]);
        delete gameState.disconnectTimers[userId];
    }
};

export function initWebSocketServer(server: http.Server) {
    const wss = new WebSocketServer({ noServer: true });
    setWss(wss);

    const heartbeatInterval = setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            const extWs = ws as AuthenticatedWebSocket & { isAlive: boolean };
            if (extWs.isAlive === false) return ws.terminate();

            extWs.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('connection', async (ws: AuthenticatedWebSocket, request, user, pathname) => {
        const extWs = ws as AuthenticatedWebSocket & { isAlive: boolean };
        extWs.isAlive = true;
        extWs.on('pong', () => {
            extWs.isAlive = true;
        });
        
        ws.user = user;
        const userId = String(user.userId);
        const encodedRoomId = pathname.split('/').pop()!;
        const roomId = decodeURIComponent(encodedRoomId);
        
        if (clientsByUserId.has(userId)) {
            console.log(`[${SERVER_ID}] Conexão duplicada detectada para o utilizador ID ${userId}. A encerrar a conexão antiga.`);
            const oldWs = clientsByUserId.get(userId);
            if (oldWs && oldWs !== ws) {
                oldWs.terminate(); 
            }
        }
        
        clientsByUserId.set(userId, ws); 
        roomsByClientId.set(ws, roomId);
        memoryStore.setUserRoom(userId, roomId);
        
        console.log(`[${SERVER_ID}] Utilizador ID ${userId} (${user.username}) conectou-se. Sala: ${roomId}. Clientes nesta instância: ${clientsByUserId.size}`);

        const gameState = await getGameState(roomId);
        let room = memoryStore.getRoom(roomId);
        
        if (!room) {
            sendError(ws, `A sala ${roomId} não foi encontrada ou foi fechada.`);
            ws.close();
            memoryStore.deleteUserFromRoom(userId, roomId);
            return;
        }

        if (gameState) {
            const playerInGame = gameState.players.find(p => p.id === userId);
            
            if (playerInGame) {
                if (playerInGame.disconnectedSince) {
                    console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} reconectou-se ao JOGO ${roomId}.`);
                    delete playerInGame.disconnectedSince;
                    clearDisconnectTimer(gameState, userId);
                    await saveGameState(roomId, gameState);
                    broadcastToRoom(roomId, { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) });
                }
                
                sendToPlayer(userId, {
                    type: 'ESTADO_ATUALIZADO',
                    myId: userId,
                    ...getPublicState(gameState),
                    yourHand: gameState.hands[userId],
                });
            } else {
                console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} tentou entrar na sala ${roomId} em jogo, mas não é um jogador.`);
                sendError(ws, "Não é possível entrar em um jogo já em andamento.");
                ws.close();
                memoryStore.deleteUserFromRoom(userId, roomId);
                return;
            }
        } else {
            if (room.status === 'playing' && !room.players.has(userId)) {
                 sendError(ws, "Não é possível entrar em um jogo já em andamento.");
                 ws.close();
                 memoryStore.deleteUserFromRoom(userId, roomId);
                 return;
            }

            room.players.add(userId);
            room.playerCount = room.players.size;
            memoryStore.saveRoom(roomId, room);

            console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} entrou no LOBBY da sala ${roomId}. Jogadores na sala: ${room.playerCount}`);
            
            broadcastToRoom(roomId, (clientInRoom) => {
                const playersInRoom = Array.from(room!.players).map(id => {
                    const playerWs = clientsByUserId.get(id);
                    const username = playerWs?.user?.username || `User-${id}`;
                    const isReady = room!.readyPlayers.has(id);
                    return { id, username, isReady };
                });
                return {
                    type: 'ROOM_STATE',
                    myId: clientInRoom.user.userId,
                    hostId: room!.hostId,
                    players: playersInRoom,
                    readyPlayers: Array.from(room!.readyPlayers),
                    playerCount: room!.playerCount,
                    maxPlayers: MAX_PLAYERS,
                    status: room!.status
                };
            });
        }
        
        ws.on('message', async (message) => {
            const currentGameState = await getGameState(roomId);
            if (currentGameState && !currentGameState.players.some(p => p.id === userId)) {
                return sendError(ws, "Você não é um jogador nesta partida.");
            }
            handleGameMessage(ws, message, roomId);
        });

        ws.on('close', async () => {
             clientsByUserId.delete(userId);
             roomsByClientId.delete(ws);
             
             console.log(`[${SERVER_ID}] Utilizador ID ${userId} desconectou-se. Clientes nesta instância: ${clientsByUserId.size}`);
             
             const currentGameState = await getGameState(roomId);
             if (currentGameState && currentGameState.players.find(p => p.id === userId)) {
                 const result = handleLeaveGame(ws, currentGameState, userId, false);
                 await processGameLogicResult(result, roomId, currentGameState);

                 const roomAfterLeave = memoryStore.getRoom(roomId);
                 if (roomAfterLeave) {
                     broadcastToRoom(roomId, (clientInRoom) => {
                        const playersForBroadcast = Array.from(roomAfterLeave.players).map(pId => {
                            const playerWs = clientsByUserId.get(pId);
                            const username = playerWs?.user?.username || `User-${pId}`;
                            const playerState = currentGameState.players.find(p => p.id === pId);
                            return { id: pId, username, disconnectedSince: playerState?.disconnectedSince };
                        });
                        return {
                            type: 'ESTADO_ATUALIZADO',
                            myId: clientInRoom.user.userId,
                            ...getPublicState(currentGameState),
                            players: playersForBroadcast
                        };
                     });
                 }

             } else {
                const room = memoryStore.getRoom(roomId);
                if (room) {
                    memoryStore.deleteUserFromRoom(userId, roomId);
                    if (room.playerCount === 0) {
                        memoryStore.deleteRoom(roomId);
                        console.log(`[${SERVER_ID}] Sala do lobby ${roomId} ficou vazia e foi removida.`);
                    } else {
                        broadcastToRoom(roomId, (clientInRoom) => {
                           const playersInRoom = Array.from(room!.players).map(id => {
                               const playerWs = clientsByUserId.get(id);
                               const username = playerWs?.user?.username || `User-${id}`;
                               const isReady = room!.readyPlayers.has(id);
                               return { id, username, isReady };
                           });
                           return {
                               type: 'ROOM_STATE',
                               myId: clientInRoom.user.userId,
                               hostId: room.hostId,
                               players: playersInRoom,
                               readyPlayers: Array.from(room!.readyPlayers),
                               playerCount: room.playerCount,
                               maxPlayers: MAX_PLAYERS,
                               status: room.status
                           };
                        });
                        console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} desconectou-se do LOBBY da sala ${roomId}. Estado atualizado enviado.`);
                    }
                } else {
                    memoryStore.deleteUserFromRoom(userId, roomId);
                }
             }
        });
    });

    server.on('upgrade', (request, socket, head) => {
        const { pathname } = url.parse(request.url!, true);
        
        if (pathname?.startsWith('/ws/game/')) {
            const cookies = cookie.parse(request.headers.cookie || '');
            const token = cookies.token;

            if (!token) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            try {
                const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
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

    wss.on('close', function close() {
        clearInterval(heartbeatInterval);
    });
}