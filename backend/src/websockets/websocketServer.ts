import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';
import { 
    startGame, 
    getGameState, 
    saveGameState, 
    getNextTurn, 
    handleLeaveGame,
    getPublicState,
    changeTurn,
    processGameLogicResult
} from './gameHandler';
import { handleGameMessage } from './messageHandler';
import { AuthenticatedWebSocket, DecodedToken, GameState } from '../types';
import { PLAYERS_TO_START_GAME, DISCONNECT_TIMEOUT } from '../config/gameConfig';
import { JWT_SECRET, SERVER_ID } from '../config/environment';
import { memoryStore, Room } from './memoryStore';
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
        const roomId = pathname.split('/').pop()!;
        
        clientsByUserId.set(userId, ws); 
        roomsByClientId.set(ws, roomId);
        memoryStore.setUserRoom(userId, roomId);
        
        console.log(`[${SERVER_ID}] Utilizador ID ${userId} (${user.username}) conectou-se. Sala: ${roomId}. Clientes nesta instância: ${clientsByUserId.size}`);

        const gameState = await getGameState(roomId);
        if (gameState) {
            const playerInGame = gameState.players.find(p => p.id === userId);
            
            if (playerInGame) { // Jogador está a reconectar
                if (playerInGame.disconnectedSince) {
                    console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} reconectou-se ao JOGO ${roomId}.`);
                    delete playerInGame.disconnectedSince;
                    clearDisconnectTimer(gameState, userId);
                    await saveGameState(roomId, gameState);
                }
                
                sendToPlayer(userId, {
                    type: 'ESTADO_ATUALIZADO',
                    myId: userId,
                    ...getPublicState(gameState),
                    yourHand: gameState.hands[userId],
                });
                return;
            } else { // NOVO: Jogador entra como OBSERVADOR
                console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} entrou como OBSERVADOR na sala ${roomId}.`);
                sendToPlayer(userId, {
                    type: 'ESTADO_ATUALIZADO',
                    myId: userId,
                    ...getPublicState(gameState),
                    yourHand: [], // Observadores não têm mão
                    isSpectator: true,
                });
            }
        } else {
            let room = memoryStore.getRoom(roomId);
            if (!room) {
                return sendError(ws, `A sala ${roomId} não foi encontrada ou foi fechada.`);
            }

            room.players.add(userId);
            room.playerCount = room.players.size;
            memoryStore.saveRoom(roomId, room);

            console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} entrou no LOBBY da sala ${roomId}. Jogadores na sala: ${room.playerCount}`);
            
            broadcastToRoom(roomId, (clientInRoom) => {
                return {
                    type: 'ROOM_STATE',
                    myId: clientInRoom.user.userId,
                    hostId: room.hostId,
                    // MODIFICADO: Mapeia os IDs para objetos com o nome de utilizador real
                    players: Array.from(room.players).map(id => {
                        const playerWs = clientsByUserId.get(id);
                        const username = playerWs?.user?.username || `User-${id}`;
                        return { id, username };
                    }),
                    playerCount: room.playerCount,
                    status: room.status
                };
            });
        }
        
        ws.on('message', async (message) => {
            const currentGameState = await getGameState(roomId);
            if (currentGameState) {
                const isPlayer = currentGameState.players.some(p => p.id === userId);
                if (!isPlayer) {
                    return sendError(ws, "Observadores não podem realizar ações.");
                }
            }
            handleGameMessage(ws, message, roomId);
        });

        ws.on('close', async () => {
             clientsByUserId.delete(userId);
             roomsByClientId.delete(ws);
             
             const room = memoryStore.getRoom(roomId);
             if (room) {
                 room.players.delete(userId);
                 room.playerCount = room.players.size;
                 memoryStore.saveRoom(roomId, room);
             }
             
             console.log(`[${SERVER_ID}] Utilizador ID ${userId} desconectou-se. Clientes nesta instância: ${clientsByUserId.size}`);
             
             const currentGameState = await getGameState(roomId);
             if (currentGameState && currentGameState.players.find(p => p.id === userId)) {
                 const result = handleLeaveGame(ws, currentGameState, userId, false);
                 await processGameLogicResult(result, roomId, currentGameState);
             } else if (room && room.playerCount > 0) { // MODIFICADO: Apenas envia se ainda houver gente na sala
                 broadcastToRoom(roomId, (clientInRoom) => {
                    return {
                        type: 'ROOM_STATE',
                        myId: clientInRoom.user.userId,
                        hostId: room.hostId,
                        // MODIFICADO: Usa a mesma lógica para obter nomes de utilizador
                        players: Array.from(room.players).map(id => {
                            const playerWs = clientsByUserId.get(id);
                            const username = playerWs?.user?.username || `User-${id}`;
                            return { id, username };
                        }),
                        playerCount: room.playerCount,
                        status: room.status
                    };
                 });
                 console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} desconectou-se do LOBBY da sala ${roomId}. Estado atualizado enviado.`);
             } else if (room && room.playerCount === 0) {
                 // Se a sala ficar vazia, remove-a.
                 memoryStore.deleteRoom(roomId);
                 console.log(`[${SERVER_ID}] Sala do lobby ${roomId} ficou vazia e foi removida.`);
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