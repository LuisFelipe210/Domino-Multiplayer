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
import { MAX_PLAYERS } from '../config/gameConfig';
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
        const encodedRoomId = pathname.split('/').pop()!;
        const roomId = decodeURIComponent(encodedRoomId);
        
        // Handle duplicate connections: terminate old connection to ensure only the latest is used.
        if (clientsByUserId.has(userId)) {
            console.log(`[${SERVER_ID}] Conexão duplicada detectada para o utilizador ID ${userId}. A encerrar a conexão antiga.`);
            const oldWs = clientsByUserId.get(userId);
            if (oldWs && oldWs !== ws) {
                // Terminating oldWs will trigger its 'close' event, which will handle marking it disconnected.
                oldWs.terminate(); 
            }
        }
        
        clientsByUserId.set(userId, ws); 
        roomsByClientId.set(ws, roomId);
        memoryStore.setUserRoom(userId, roomId); // Set user's room mapping immediately
        
        console.log(`[${SERVER_ID}] Utilizador ID ${userId} (${user.username}) conectou-se. Sala: ${roomId}. Clientes nesta instância: ${clientsByUserId.size}`);

        const gameState = await getGameState(roomId);
        let room = memoryStore.getRoom(roomId); // Get room info even if game state exists
        
        if (!room) { // Room does not exist at all (e.g., deleted due to inactivity or host leaving)
            sendError(ws, `A sala ${roomId} não foi encontrada ou foi fechada.`);
            ws.close();
            memoryStore.deleteUserFromRoom(userId, roomId); // Clean up userToRoomMap if still there
            return;
        }

        if (gameState) { // There is an active game in this room
            const playerInGame = gameState.players.find(p => p.id === userId);
            
            if (playerInGame) { // Player is re-connecting to an active game
                if (playerInGame.disconnectedSince) {
                    console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} reconectou-se ao JOGO ${roomId}.`);
                    delete playerInGame.disconnectedSince;
                    clearDisconnectTimer(gameState, userId);
                    await saveGameState(roomId, gameState);
                    // Broadcast updated game state to show player reconnected
                    broadcastToRoom(roomId, { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) });
                }
                
                // Send full game state to the reconnected player
                sendToPlayer(userId, {
                    type: 'ESTADO_ATUALIZADO',
                    myId: userId,
                    ...getPublicState(gameState),
                    yourHand: gameState.hands[userId],
                });
            } else { // Game is active, but this user is not a player in it
                console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} tentou entrar na sala ${roomId} em jogo, mas não é um jogador.`);
                sendError(ws, "Não é possível entrar em um jogo já em andamento.");
                ws.close();
                memoryStore.deleteUserFromRoom(userId, roomId); // Clean up userToRoomMap for observers/non-players
                return;
            }
        } else { // No active game state, so it's a lobby room
            // If room status is 'playing' but there's no gameState, it's an inconsistent state
            if (room.status === 'playing' && !room.players.has(userId)) {
                 sendError(ws, "Não é possível entrar em um jogo já em andamento.");
                 ws.close();
                 memoryStore.deleteUserFromRoom(userId, roomId); // Clean up userToRoomMap if trying to join a playing room
                 return;
            }

            room.players.add(userId);
            room.playerCount = room.players.size;
            memoryStore.saveRoom(roomId, room);

            console.log(`[${SERVER_ID}] Utilizador ID ${user.userId} entrou no LOBBY da sala ${roomId}. Jogadores na sala: ${room.playerCount}`);
            
            // Broadcast room state to all clients in this lobby room
            broadcastToRoom(roomId, (clientInRoom) => {
                const playersInRoom = Array.from(room!.players).map(id => {
                    const playerWs = clientsByUserId.get(id);
                    const username = playerWs?.user?.username || `User-${id}`;
                    const isReady = room!.readyPlayers.has(id);
                    return { id, username, isReady }; // Include isReady status
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
            // Ensure the user sending message is a player in an active game, if a game state exists.
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
                 // Player was in an active game. Mark them as disconnected, but DO NOT remove from room.players.
                 // The 'disconnectedSince' logic in handleLeaveGame and gameHandler.ts manages temporary disconnections.
                 const result = handleLeaveGame(ws, currentGameState, userId, false);
                 await processGameLogicResult(result, roomId, currentGameState);

                 // After processing, broadcast updated room state (player list with disconnected status)
                 // to other players in the room, so they see the disconnection.
                 const roomAfterLeave = memoryStore.getRoom(roomId); // Get updated room after handleLeaveGame logic
                 if (roomAfterLeave) {
                     broadcastToRoom(roomId, (clientInRoom) => {
                        const playersForBroadcast = Array.from(roomAfterLeave.players).map(pId => {
                            const playerWs = clientsByUserId.get(pId);
                            const username = playerWs?.user?.username || `User-${pId}`;
                            // Find the player in the currentGameState (which was potentially updated by handleLeaveGame)
                            const playerState = currentGameState.players.find(p => p.id === pId);
                            return { id: pId, username, disconnectedSince: playerState?.disconnectedSince };
                        });
                        return {
                            type: 'ESTADO_ATUALIZADO', // Broadcast as ESTADO_ATUALIZADO for game players
                            myId: clientInRoom.user.userId,
                            ...getPublicState(currentGameState), // Reuse public state but update players list
                            players: playersForBroadcast // Ensure disconnected status is reflected
                        };
                     });
                 }

             } else { // Player was in a lobby room OR game ended and room was already removed
                      // In this case, it's safe to fully remove the user from the room data.
                const room = memoryStore.getRoom(roomId);
                if (room) {
                    memoryStore.deleteUserFromRoom(userId, roomId); // Safely remove from room players and userToRoomMap
                    if (room.playerCount === 0) { // Check playerCount after deleting the user
                        memoryStore.deleteRoom(roomId);
                        console.log(`[${SERVER_ID}] Sala do lobby ${roomId} ficou vazia e foi removida.`);
                    } else {
                        // Broadcast updated room state for lobby clients
                        broadcastToRoom(roomId, (clientInRoom) => {
                           const playersInRoom = Array.from(room!.players).map(id => {
                               const playerWs = clientsByUserId.get(id);
                               const username = playerWs?.user?.username || `User-${id}`;
                               const isReady = room!.readyPlayers.has(id);
                               return { id, username, isReady };
                           });
                           return {
                               type: 'ROOM_STATE', // Send ROOM_STATE for lobby players
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
                    // Room might have been deleted by `endGame` if host left and room became empty.
                    // Just ensure userToRoomMap is cleaned up if room is already gone.
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