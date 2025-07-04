import { RawData } from 'ws';
import { AuthenticatedWebSocket, GameLogicResult, GameMessage } from '../types'; // <--- TIPO 'GameMessage' ADICIONADO
import { 
    getGameState, 
    saveGameState,
    endGame,
    handlePlayPiece, 
    handlePassTurn, 
    handleLeaveGame 
} from './gameHandler';
import { sendError, broadcastToRoom } from './gameUtils'; // 'sendToPlayer' removido pois é usado via pub/sub
import { redisClient } from '../config/redis';

/**
 * Ponto de entrada para mensagens WebSocket.
 * Analisa a mensagem, chama a lógica de jogo apropriada e processa o resultado.
 */
export const handleGameMessage = async (ws: AuthenticatedWebSocket, message: RawData, roomId: string) => {
    let data: GameMessage; // <--- AGORA USA O TIPO DE UNIÃO
    try {
        data = JSON.parse(message.toString());
    } catch (e) {
        return sendError(ws, "Formato de mensagem inválido."); // Ignora mensagem inválida
    }

    const userId = String(ws.user.userId);
    let gameState = await getGameState(roomId);
    if (!gameState) {
        return sendError(ws, "O jogo não foi encontrado ou já terminou.");
    }

    const player = gameState.players.find(p => p.id === userId);

    // Validações genéricas
    if (player?.disconnectedSince) {
        return sendError(ws, "Você está desconectado. Recarregue para reconectar.");
    }
    // A validação de turno para 'LEAVE_GAME' é removida, pois um jogador pode sair a qualquer momento.
    if (gameState.turn !== userId && ['PLAY_PIECE', 'PASS_TURN'].includes(data.type)) {
        return sendError(ws, 'Não é a sua vez.');
    }

    let result: GameLogicResult = {};
    switch (data.type) {
        case 'PLAY_PIECE':
            // 'data' aqui é automaticamente inferido como 'PlayPieceMessage' pelo TypeScript!
            result = handlePlayPiece(gameState, userId, data);
            break;
        case 'PASS_TURN':
            result = handlePassTurn(gameState, userId);
            break;
        case 'LEAVE_GAME':
            result = handleLeaveGame(ws, gameState, userId, false);
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
            // Usando o sistema de Pub/Sub para todos os eventos
            if (event.target === 'player') {
                redisClient.publish('game-events', JSON.stringify({ targetUserId: userId, payload: event.payload }));
            }
            if (event.target === 'broadcast') {
                broadcastToRoom(roomId, event.payload);
            }
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