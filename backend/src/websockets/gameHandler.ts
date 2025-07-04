import { redisClient } from '../config/redis';
import { pool } from '../config/database';
import { GameState, Domino, Player, PlacedDomino, BoardEnd, GameLogicResult, GameEvent } from '../types';
import { PLAYERS_TO_START_GAME, INITIAL_HAND_SIZE } from '../config/gameConfig';
import { sendToPlayer } from './gameUtils';
import { SERVER_ID } from '../config/environment';

// --- Funções de Acesso ao Estado ---
export const getGameState = async (roomId: string): Promise<GameState | null> => {
  const gameStateRaw = await redisClient.get(`game_state:${roomId}`);
  return gameStateRaw ? JSON.parse(gameStateRaw) : null;
};

export const saveGameState = (roomId: string, gameState: GameState) => {
  const stateToSave = { ...gameState, disconnectTimers: undefined };
  return redisClient.set(`game_state:${roomId}`, JSON.stringify(stateToSave));
};

// --- Funções Utilitárias ---
const createDominoSet = (): Domino[] => {
  const pieces: Domino[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      pieces.push({ value1: i, value2: j });
    }
  }
  return pieces;
};

const shuffle = <T>(array: T[]): T[] => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

export const getNextTurn = (currentPlayerId: string, players: Player[]): string => {
    const activePlayers = players.filter(p => !p.disconnectedSince);
    if (activePlayers.length === 0) return '';
    const currentIndex = activePlayers.findIndex(p => p.id === currentPlayerId);
    if (currentIndex === -1) {
      const originalPlayerIndex = players.findIndex(p => p.id === currentPlayerId);
      for (let i = 1; i < players.length; i++) {
          const nextPlayer = players[(originalPlayerIndex + i) % players.length];
          if (!nextPlayer.disconnectedSince) {
              return nextPlayer.id;
          }
      }
      return '';
    }
    return activePlayers[(currentIndex + 1) % activePlayers.length].id;
};

const getPublicState = (gameState: GameState) => {
    const playerPieceCounts = Object.fromEntries(
        gameState.players.map(p => [p.id, gameState.hands[p.id]?.length || 0])
    );
    return {
        board: gameState.board,
        turn: gameState.turn,
        players: gameState.players,
        activeEnds: gameState.activeEnds,
        playerPieceCounts: playerPieceCounts,
    };
};

// --- NOVA LÓGICA DE POSICIONAMENTO ---

// Devolve as coordenadas da segunda metade de uma peça, baseado na sua origem e rotação
function getSecondCell(x: number, y: number, rotation: 0 | 90 | 180 | 270): { x2: number, y2: number } {
    if (rotation === 0) return { x2: x + 1, y2: y };   // Horizontal para a direita
    if (rotation === 90) return { x2: x, y2: y + 1 };    // Vertical para baixo
    if (rotation === 180) return { x2: x - 1, y2: y }; // Horizontal para a esquerda
    if (rotation === 270) return { x2: x, y2: y - 1 };  // Vertical para cima
    return { x2: x, y2: y };
}


export function handlePlayPiece(gameState: GameState, userId: string, data: any): GameLogicResult {
    const hand = gameState.hands[userId];
    if (!hand) return { error: 'Mão do jogador não encontrada.' };
    
    const pieceToPlay: Domino = data.piece;
    const chosenEndId: string | undefined = data.endId;
    const pieceIndex = hand.findIndex(p => (p.value1 === pieceToPlay.value1 && p.value2 === pieceToPlay.value2) || (p.value1 === pieceToPlay.value2 && p.value2 === pieceToPlay.value1));
    if (pieceIndex === -1) return { error: 'Você não possui esta peça.' };

    const actualPiece = hand[pieceIndex];
    const isDouble = actualPiece.value1 === actualPiece.value2;
    let newPiece: PlacedDomino;

    if (gameState.board.length === 0) {
        const rotation = isDouble ? 90 : 0;
        newPiece = { piece: actualPiece, x: 0, y: 0, rotation, isSpinner: isDouble };
        const { x2, y2 } = getSecondCell(0, 0, rotation);
        gameState.occupiedCells['0,0'] = true;
        gameState.occupiedCells[`${x2},${y2}`] = true;
        
        if (isDouble) {
            gameState.activeEnds.push({ id: `end-left`, value: actualPiece.value1, x: -1, y: 0, attachDirection: 180 });
            gameState.activeEnds.push({ id: `end-right`, value: actualPiece.value1, x: 1, y: 0, attachDirection: 0 });
        } else {
            gameState.activeEnds.push({ id: `end-left`, value: actualPiece.value1, x: -1, y: 0, attachDirection: 180 });
            gameState.activeEnds.push({ id: `end-right`, value: actualPiece.value2, x: 2, y: 0, attachDirection: 0 });
        }

    } else {
        const validPlacements = gameState.activeEnds.filter(end => end.value === actualPiece.value1 || end.value === actualPiece.value2);
        if (validPlacements.length === 0) return { error: 'Jogada inválida.' };

        if (validPlacements.length > 1 && !chosenEndId) {
            return { events: [{ target: 'player', payload: { type: 'CHOOSE_PLACEMENT', piece: actualPiece, options: validPlacements.map(p => ({endId: p.id, value: p.value})) } }] };
        }
        
        const targetEnd = chosenEndId ? validPlacements.find(e => e.id === chosenEndId) : validPlacements[0];
        if (!targetEnd) return { error: 'A ponta escolhida não é válida.' };
        
        let rotation = targetEnd.attachDirection;
        let connectingValue = targetEnd.value;
        let x = targetEnd.x, y = targetEnd.y;

        // Garante que o valor1 da peça é o que conecta
        if (actualPiece.value2 === connectingValue) {
            [actualPiece.value1, actualPiece.value2] = [actualPiece.value2, actualPiece.value1];
        }
        
        if (isDouble) rotation = (targetEnd.attachDirection + 90) % 360 as 90 | 180 | 270 | 0;

        const { x2, y2 } = getSecondCell(x, y, rotation);
        if (gameState.occupiedCells[`${x},${y}`] || gameState.occupiedCells[`${x2},${y2}`]) {
             return { error: 'Posição já ocupada.' };
        }

        newPiece = { piece: actualPiece, x, y, rotation, isSpinner: isDouble };
        gameState.occupiedCells[`${x},${y}`] = true;
        gameState.occupiedCells[`${x2},${y2}`] = true;
        
        gameState.activeEnds = gameState.activeEnds.filter(e => e.id !== targetEnd.id);

        if (isDouble) {
            const potentialEnds = [
                { dir: 0,   x: x2 + 1, y: y2 }, { dir: 180, x: x - 1,  y: y  },
                { dir: 90,  x: x,      y: y + 1  }, { dir: 270, x: x,      y: y - 1  }
            ];
            potentialEnds.forEach((end, i) => {
                if(!gameState.occupiedCells[`${end.x},${end.y}`]){
                    gameState.activeEnds.push({ id: `end-${Date.now()}-${i}`, value: newPiece.piece.value1, x: end.x, y: end.y, attachDirection: end.dir as any });
                }
            });

        } else {
            const { x2: nextX, y2: nextY } = getSecondCell(x2, y2, rotation);
            if(!gameState.occupiedCells[`${nextX},${nextY}`]){
                gameState.activeEnds.push({ id: `end-${Date.now()}`, value: newPiece.piece.value2, x: nextX, y: nextY, attachDirection: rotation });
            }
        }
    }

    gameState.board.push(newPiece);
    hand.splice(pieceIndex, 1);
    
    const events: GameEvent[] = [{ target: 'player', payload: { type: 'UPDATE_HAND', yourNewHand: hand } }];

    if (hand.length === 0) {
        const winner = gameState.players.find(p => p.id === userId)!;
        return { newState: gameState, events, terminal: { winner, reason: "O jogador bateu!" } };
    }
    
    if (gameState.activeEnds.length === 0) {
        const passResult = handlePassTurn(gameState, userId, true);
        return { ...passResult, events: [...events, ...(passResult.events || [])] };
    }

    gameState.turn = getNextTurn(userId, gameState.players);
    gameState.consecutivePasses = 0;
    
    events.push({ target: 'broadcast', payload: { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) }});
    return { newState: gameState, events };
}


// --- RESTO DAS FUNÇÕES (startGame, endGame, etc.) ---

export async function startGame(roomId: string) {
    console.log(`[${SERVER_ID}] Starting game in room ${roomId}`);
    const playerIds = await redisClient.sMembers(`room:players:${roomId}`);
    const players: Player[] = [];
    for (const id of playerIds) {
        const username = await redisClient.get(`user:${id}:username`);
        players.push({ id, username: username || `User-${id}` });
        await redisClient.set(`user:active_game:${id}`, roomId, { EX: 3600 });
    }

    if (players.length < PLAYERS_TO_START_GAME) return;

    await redisClient.hDel('public_rooms', roomId);
    const dominoSet = shuffle(createDominoSet());
    const hands = Object.fromEntries(players.map(p => [p.id, dominoSet.splice(0, INITIAL_HAND_SIZE)]));

    const gameState: GameState = {
        board: [], activeEnds: [], hands, turn: players[0].id,
        players, consecutivePasses: 0, disconnectTimers: {}, occupiedCells: {}
    };

    await saveGameState(roomId, gameState);
    console.log(`[${SERVER_ID}] Initial game state for ${roomId} saved. Turn: ${gameState.turn}`);

    players.forEach(player => {
        sendToPlayer(player.id, {
            type: 'JOGO_INICIADO',
            myId: player.id,
            yourHand: gameState.hands[player.id],
            ...getPublicState(gameState)
        });
    });
}

export async function endGame(roomId: string, gameState: GameState, winner: Player | null, reason: string) {
    const winnerIdentifier = winner ? `ID ${winner.id}` : 'Ninguém';
    console.log(`[${SERVER_ID}] Game over in room ${roomId}. Winner: ${winnerIdentifier}. Reason: ${reason}`);
    if (gameState.disconnectTimers) Object.values(gameState.disconnectTimers).forEach(clearTimeout);
    
    redisClient.publish('game-events', JSON.stringify({ 
        roomId, 
        payload: { type: 'JOGO_TERMINADO', winner: winner ? winner.username : 'Ninguém', reason } 
    }));

    try {
        if(winner && winner.id.match(/^\d+$/)) {
            await pool.query(
                'INSERT INTO match_history (room_id, winner_id, winner_username, players) VALUES ($1, $2, $3, $4)',
                [parseInt(winner.id, 10), winner.username, JSON.stringify(gameState.players.map(p => ({id: p.id, username: p.username})))]
            );
        }
    } catch (e) { console.error("Error saving match history:", e); }

    const playerIds = gameState.players.map(p => `user:active_game:${p.id}`);
    if (playerIds.length > 0) await redisClient.del(playerIds);
    
    await redisClient.del([`game_state:${roomId}`, `room:players:${roomId}`]);
    await redisClient.hDel('public_rooms', roomId);
    await redisClient.sRem('active_rooms_set', roomId);
    await redisClient.hSet(`room:${roomId}`, 'status', 'finished');
}

export function handlePassTurn(gameState: GameState, userId: string, forceEndCheck = false): GameLogicResult {
    gameState.consecutivePasses++;
    const activePlayersCount = gameState.players.filter(p => !p.disconnectedSince).length;

    if (forceEndCheck || gameState.consecutivePasses >= activePlayersCount) {
        let winner: Player | null = null;
        let minPoints = Infinity;
        
        gameState.players.forEach(p => {
            if (!p.disconnectedSince) {
                const points = gameState.hands[p.id]?.reduce((sum, piece) => sum + piece.value1 + piece.value2, 0) || 0;
                if (points < minPoints) {
                    minPoints = points;
                    winner = p;
                } else if (points === minPoints) {
                    winner = null;
                }
            }
        });
        
        const reason = winner ? "Jogo fechado! Vitória por menos pontos." : "Jogo fechado! Empate.";
        return { newState: gameState, terminal: { winner, reason } };
    }

    gameState.turn = getNextTurn(userId, gameState.players);
    const events: GameEvent[] = [{ target: 'broadcast', payload: { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) } }];
    return { newState: gameState, events };
}

export function handleLeaveGame(gameState: GameState, userId: string, forceRemove = false): GameLogicResult {
    const leavingPlayer = gameState.players.find(p => p.id === userId);
    if (!leavingPlayer) return { newState: gameState };

    const playerIndex = gameState.players.findIndex(p => p.id === userId);
    if(playerIndex > -1) gameState.players[playerIndex].disconnectedSince = Date.now();

    const remainingPlayers = gameState.players.filter(p => !p.disconnectedSince);
    let reason = `Jogador ID ${userId} ${forceRemove ? 'foi removido' : 'abandonou'}.`;
    let winner: Player | null = null;

    if (remainingPlayers.length === 1) {
        winner = remainingPlayers[0];
        reason += ` ${winner.username} é o vencedor.`;
        return { newState: gameState, terminal: { winner, reason } };
    } else if (remainingPlayers.length === 0) {
        reason = 'Todos os jogadores saíram.';
        return { newState: gameState, terminal: { winner: null, reason } };
    }
    
    if (gameState.turn === userId) gameState.turn = getNextTurn(userId, gameState.players);
    
    const events: GameEvent[] = [{ target: 'broadcast', payload: { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) } }];
    return { newState: gameState, events };
}