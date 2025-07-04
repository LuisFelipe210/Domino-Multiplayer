import { RawData } from 'ws';
import { AuthenticatedWebSocket, GameLogicResult } from '../types';
import { 
    getGameState, 
    saveGameState,
    endGame,
    handlePlayPiece, 
    handlePassTurn, 
    handleLeaveGame 
} from './gameHandler';
import { sendError, sendToPlayer, broadcastToRoom } from './gameUtils';

/**
 * Ponto de entrada para mensagens WebSocket.
 * Analisa a mensagem, chama a lógica de jogo apropriada e processa o resultado.
 */
export const handleGameMessage = async (ws: AuthenticatedWebSocket, message: RawData, roomId: string) => {
    let data;
    try {
        data = JSON.parse(message.toString());
    } catch (e) {
        return; // Ignora mensagem inválida
    }

    let gameState = await getGameState(roomId);
    if (!gameState) {
        return sendError(ws, "O jogo não foi encontrado ou já terminou.");
    }

    const userId = String(ws.user.userId);
    const player = gameState.players.find(p => p.id === userId);

    // Validações genéricas
    if (player?.disconnectedSince) {
        return sendError(ws, "Você está desconectado. Recarregue para reconectar.");
    }
    if (data.type !== 'LEAVE_GAME' && gameState.turn !== userId && ['PLAY_PIECE', 'PASS_TURN'].includes(data.type)) {
        return sendError(ws, 'Não é a sua vez.');
    }

    let result: GameLogicResult = {};
    switch (data.type) {
        case 'PLAY_PIECE':
            result = handlePlayPiece(gameState, userId, data);
            break;
        case 'PASS_TURN':
            result = handlePassTurn(gameState, userId);
            break;
        case 'LEAVE_GAME':
            result = handleLeaveGame(gameState, userId, false);
            break;
        default:
            return sendError(ws, "Tipo de mensagem desconhecido.");
    }

    // Processar o resultado da lógica do jogo
    if (result.error) {
        sendError(ws, result.error);
    }

    if (result.events) {
        result.events.forEach((event: any) => {
            if (event.target === 'player') sendToPlayer(userId, event.payload);
            if (event.target === 'broadcast') broadcastToRoom(roomId, event.payload);
        });
    }

    if (result.newState) {
        gameState = result.newState;
    }
    
    if (result.terminal) {
        // A lógica do jogo decidiu que o jogo deve terminar
        await endGame(roomId, gameState, result.terminal.winner, result.terminal.reason);
    } else if (result.newState) {
        // Se houve uma mudança de estado, mas o jogo não terminou, salve-o
        await saveGameState(roomId, gameState);
    }
};