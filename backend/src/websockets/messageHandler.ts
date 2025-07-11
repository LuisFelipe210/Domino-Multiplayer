import { RawData } from 'ws';
import { AuthenticatedWebSocket, GameLogicResult, GameMessage, ChatMessageObject } from '../types';
import { 
    getGameState, 
    handlePlayPiece, 
    handlePassTurn, 
    handleLeaveGame,
    handlePlayerReady,
    handleStartGame,
    processGameLogicResult,
    saveGameState
} from './gameHandler';
import { broadcastToRoom, sendError } from './gameUtils';

export const handleGameMessage = async (ws: AuthenticatedWebSocket, message: RawData, roomId: string) => {
    let data: GameMessage;
    try {
        data = JSON.parse(message.toString());
    } catch (e) {
        return sendError(ws, "Formato de mensagem inválido.");
    }

    const userId = String(ws.user.userId);
    let gameState = await getGameState(roomId);

    if (!gameState && !['PLAYER_READY', 'START_GAME', 'CHAT_MESSAGE'].includes(data.type)) {
        return sendError(ws, "O jogo não foi encontrado ou já terminou.");
    }

    if (gameState) {
        const player = gameState.players.find(p => p.id === userId);
        if (player?.disconnectedSince) {
            return sendError(ws, "Você está desconectado. Recarregue para reconectar.");
        }
        if (gameState.turn !== userId && ['PLAY_PIECE', 'PASS_TURN'].includes(data.type)) {
            return sendError(ws, 'Não é a sua vez.');
        }
    }

    let result: GameLogicResult = {};
    switch (data.type) {
        case 'PLAY_PIECE':
            result = handlePlayPiece(gameState!, userId, data, roomId);
            break;
        case 'PASS_TURN':
            result = handlePassTurn(gameState!, userId, roomId);
            break;
        case 'LEAVE_GAME':
            result = handleLeaveGame(ws, gameState!, userId, false);
            break;
        case 'PLAYER_READY':
            result = handlePlayerReady(userId, roomId);
            break;
        case 'START_GAME':
            result = handleStartGame(userId, roomId);
            break;
        case 'CHAT_MESSAGE':
            if (gameState) {
                const newChatMessage: ChatMessageObject = {
                    username: ws.user.username,
                    message: data.message,
                    timestamp: Date.now()
                };
                gameState.chatHistory.push(newChatMessage);
                await saveGameState(roomId, gameState);
                
                broadcastToRoom(roomId, {
                    type: 'NEW_CHAT_MESSAGE',
                    ...newChatMessage
                });
            }
            return;
        default:
            return sendError(ws, "Tipo de mensagem desconhecido.");
    }

    if (result.error) {
        sendError(ws, result.error);
    } else if (result.newState || result.events || result.terminal) {
        await processGameLogicResult(result, roomId, gameState!);
    }
};