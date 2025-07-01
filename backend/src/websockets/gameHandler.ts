// backend/src/websockets/gameHandler.ts
import { WebSocket } from 'ws';
import { redisClient } from '../config/redis';
import { pool } from '../config/database';

const SERVER_ID = process.env.SERVER_ID || 'default-server';
const PLAYERS_TO_START_GAME = 2;

// --- INTERFACES E TIPOS ---
interface Domino { value1: number; value2: number; }
interface Player { id: string; username: string; disconnectedSince?: number; }
interface GameState {
  board: Domino[];
  hands: Record<string, Domino[]>;
  boneyard: Domino[];
  turn: string;
  players: Player[];
  consecutivePasses: number;
}

// --- FUNÇÕES UTILITÁRIAS ---
function createDominoSet(): Domino[] {
  const pieces: Domino[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      pieces.push({ value1: i, value2: j });
    }
  }
  return pieces;
}

function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getNextTurn(currentPlayerId: string, players: Player[]): string {
    const activePlayers = players.filter(p => !p.disconnectedSince);
    if (activePlayers.length === 0) return '';
    const currentPlayerIndex = activePlayers.findIndex(p => p.id === currentPlayerId);
    if (currentPlayerIndex === -1) return activePlayers[0]?.id || '';
    const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
    return activePlayers[nextPlayerIndex].id;
}

// --- LÓGICA DE JOGO ---
export async function startGame(roomId: string) {
    console.log(`[${SERVER_ID}] A iniciar o jogo na sala ${roomId}...`);
    
    const playerIds = await redisClient.sMembers(`room:players:${roomId}`);
    const players: Player[] = [];
    for(const id of playerIds) {
        const username = await redisClient.get(`user:${id}:username`);
        players.push({ id, username: username || 'Desconhecido' });
    }

    if (players.length < PLAYERS_TO_START_GAME) return;

    let dominoSet = shuffle(createDominoSet());

    const gameState: GameState = {
        board: [],
        hands: {},
        boneyard: [],
        turn: players[0].id,
        players: players,
        consecutivePasses: 0,
    };

    players.forEach((player) => {
        gameState.hands[player.id] = dominoSet.splice(0, 7);
    });
    gameState.boneyard = dominoSet;

    await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));
    console.log(`[${SERVER_ID}] Estado do jogo para a sala ${roomId} guardado no Redis.`);

    players.forEach(player => {
        const personalState = {
            type: 'JOGO_INICIADO',
            yourHand: gameState.hands[player.id],
            gameState: {
                board: gameState.board,
                turn: gameState.turn,
                players: gameState.players,
                boneyardSize: gameState.boneyard.length,
            }
        };
        redisClient.publish('game-events', JSON.stringify({
            targetUserId: player.id,
            payload: personalState
        }));
    });
}

export async function endGame(roomId: string, gameState: GameState, winner: Player, reason: string) {
    console.log(`[${SERVER_ID}] Jogo na sala ${roomId} terminado. Vencedor: ${winner.username}. Motivo: ${reason}`);

    redisClient.publish('game-events', JSON.stringify({
        roomId,
        payload: {
            type: 'JOGO_TERMINADO',
            winner: winner.username,
            reason: reason,
        }
    }));

    try {
        await pool.query(
            'INSERT INTO match_history (room_id, winner_id, winner_username, players) VALUES ($1, $2, $3, $4)',
            [roomId, winner.id, winner.username, JSON.stringify(gameState.players)]
        );
    } catch (error) {
        console.error(`[${SERVER_ID}] Erro ao guardar o histórico da partida:`, error);
    }

    await redisClient.del(`game_state:${roomId}`);
    await redisClient.del(`room:${roomId}`);
    await redisClient.del(`room:players:${roomId}`);
    await redisClient.sRem('active_rooms_set', roomId);
}


export const handleGameMessage = async (ws: WebSocket, data: any, roomId: string) => {
    const currentUser = (ws as any).user;
    const gameStateRaw = await redisClient.get(`game_state:${roomId}`);
    if (!gameStateRaw) return;
    const gameState: GameState = JSON.parse(gameStateRaw);

    if (gameState.turn !== currentUser.userId && ['PLAY_PIECE', 'DRAW_PIECE', 'PASS_TURN'].includes(data.type)) {
        ws.send(JSON.stringify({ type: 'ERRO', message: 'Não é a sua vez.' }));
        return;
    }

    let shouldBroadcastPublicState = true;

    switch (data.type) {
        case 'PLAY_PIECE':
            const pieceToPlay: Domino = data.piece;
            const { placement } = data;
            const hand = gameState.hands[currentUser.userId];
            const pieceIndex = hand.findIndex(p => 
                (p.value1 === pieceToPlay.value1 && p.value2 === pieceToPlay.value2) ||
                (p.value1 === pieceToPlay.value2 && p.value2 === pieceToPlay.value1)
            );

            if (pieceIndex === -1) {
                ws.send(JSON.stringify({ type: 'ERRO', message: 'Você não tem essa peça.' }));
                return;
            }

            const leftEnd = gameState.board.length > 0 ? gameState.board[0].value1 : null;
            const rightEnd = gameState.board.length > 0 ? gameState.board[gameState.board.length - 1].value2 : null;
            
            const canPlaceLeft = leftEnd !== null && (pieceToPlay.value1 === leftEnd || pieceToPlay.value2 === leftEnd);
            const canPlaceRight = rightEnd !== null && (pieceToPlay.value1 === rightEnd || pieceToPlay.value2 === rightEnd);

            if (gameState.board.length > 0) {
                if (!canPlaceLeft && !canPlaceRight) {
                    ws.send(JSON.stringify({ type: 'ERRO', message: 'Jogada inválida. A peça não encaixa.' }));
                    return;
                }
                if (canPlaceLeft && canPlaceRight && !placement) {
                    ws.send(JSON.stringify({ type: 'CHOOSE_PLACEMENT', piece: pieceToPlay }));
                    return;
                }
            }

            hand.splice(pieceIndex, 1);
            
            if (gameState.board.length === 0) {
                gameState.board.push(pieceToPlay);
            } else if (placement === 'left' || (canPlaceLeft && !canPlaceRight)) {
                if(pieceToPlay.value1 === leftEnd) gameState.board.unshift({ value1: pieceToPlay.value2, value2: pieceToPlay.value1 });
                else gameState.board.unshift(pieceToPlay);
            } else {
                if(pieceToPlay.value1 === rightEnd) gameState.board.push(pieceToPlay);
                else gameState.board.push({ value1: pieceToPlay.value2, value2: pieceToPlay.value1 });
            }

            if (hand.length === 0) {
                const winnerPlayer = gameState.players.find(p => p.id === currentUser.userId)!;
                endGame(roomId, gameState, winnerPlayer, "O jogador bateu!");
                return;
            }

            gameState.turn = getNextTurn(currentUser.userId, gameState.players);
            gameState.consecutivePasses = 0;
            break;

        case 'DRAW_PIECE':
            if (gameState.boneyard.length === 0) {
                ws.send(JSON.stringify({ type: 'ERRO', message: 'O dormitório está vazio.' }));
                return;
            }
            const newPiece = gameState.boneyard.pop()!;
            gameState.hands[currentUser.userId].push(newPiece);
            
            ws.send(JSON.stringify({ type: 'NOVA_PECA', yourNewHand: gameState.hands[currentUser.userId] }));
            break;

        case 'PASS_TURN':
            gameState.consecutivePasses++;
            
            if (gameState.consecutivePasses >= gameState.players.length) {
                let winner = gameState.players[0];
                let minPoints = 1000;
                
                gameState.players.forEach(p => {
                    const points = gameState.hands[p.id].reduce((sum, piece) => sum + piece.value1 + piece.value2, 0);
                    if (points < minPoints) {
                        minPoints = points;
                        winner = p;
                    }
                });
                
                endGame(roomId, gameState, winner, "Jogo fechado!");
                return;
            }

            gameState.turn = getNextTurn(currentUser.userId, gameState.players);
            break;
    }

    await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));

    if (shouldBroadcastPublicState) {
        const publicGameState = {
            type: 'ESTADO_ATUALIZADO',
            board: gameState.board,
            turn: gameState.turn,
            players: gameState.players,
            boneyardSize: gameState.boneyard.length,
        };
        redisClient.publish('game-events', JSON.stringify({ roomId, payload: publicGameState }));
    }
};
