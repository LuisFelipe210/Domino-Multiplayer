import { pool } from '../config/database';
import { GameState, Domino, Player, PlacedDomino, BoardEnd, GameLogicResult, GameEvent, AuthenticatedWebSocket, PlayPieceMessage } from '../types';
import { MIN_PLAYERS_TO_START, INITIAL_HAND_SIZE, TURN_DURATION, MAX_PLAYERS, BOARD_WIDTH_UNITS, BOARD_HEIGHT_UNITS } from '../config/gameConfig';
import { sendToPlayer, broadcastToRoom, broadcastToLobby, sendError } from './gameUtils';
import { SERVER_ID } from '../config/environment';
import { memoryStore } from './memoryStore';
import { clientsByUserId } from './websocketServer';

const activeTurnTimers = new Map<string, NodeJS.Timeout>();

const clearTurnTimer = (roomId: string) => {
    if (activeTurnTimers.has(roomId)) {
        clearTimeout(activeTurnTimers.get(roomId)!);
        activeTurnTimers.delete(roomId);
    }
};

export const startTurnTimer = (roomId: string, gameState: GameState) => {
    clearTurnTimer(roomId);

    const currentPlayerId = gameState.turn;
    if (!currentPlayerId) return;

    const timerId = setTimeout(async () => {
        console.log(`[${SERVER_ID}] Tempo esgotado para o jogador ${currentPlayerId} na sala ${roomId}.`);
        
        const currentState = await getGameState(roomId);
        // Assegura que o jogo ainda está a decorrer e que é a vez deste jogador
        if (!currentState || currentState.turn !== currentPlayerId) {
            return;
        }

        const hand = currentState.hands[currentPlayerId];
        // Se não tiver mão ou peças, passa a vez (salvaguarda para estados inconsistentes)
        if (!hand || hand.length === 0) {
            console.log(`[${SERVER_ID}] Timeout: jogador ${currentPlayerId} não tem mão ou peças, passando a vez.`);
            const result = handlePassTurn(currentState, currentPlayerId, roomId);
            await processGameLogicResult(result, roomId, currentState);
            return;
        }

        let firstValidMove: { piece: Domino; endId?: string } | null = null;

        if (currentState.board.length === 0) {
            // Qualquer peça pode ser jogada. Joga a primeira.
            firstValidMove = { piece: hand[0] };
        } else {
            // Encontra a primeira peça na mão que pode ser jogada em qualquer ponta ativa.
            for (const piece of hand) {
                const validEnd = currentState.activeEnds.find(end => end.value === piece.value1 || end.value === piece.value2);
                if (validEnd) {
                    firstValidMove = { piece, endId: validEnd.id };
                    break; // Encontrou uma jogada válida, para de procurar.
                }
            }
        }

        let result: GameLogicResult;
        if (firstValidMove) {
            // Foi encontrada uma jogada válida, executa-a.
            console.log(`[${SERVER_ID}] Jogando peça automaticamente para ${currentPlayerId}: peça ${firstValidMove.piece.value1}-${firstValidMove.piece.value2}`);
            result = handlePlayPiece(currentState, currentPlayerId, { type: 'PLAY_PIECE', piece: firstValidMove.piece, endId: firstValidMove.endId }, roomId);
        } else {
            // Nenhuma jogada válida, passa a vez.
            console.log(`[${SERVER_ID}] Nenhuma jogada válida para ${currentPlayerId}, passando a vez.`);
            result = handlePassTurn(currentState, currentPlayerId, roomId);
        }

        await processGameLogicResult(result, roomId, currentState);

    }, TURN_DURATION);

    activeTurnTimers.set(roomId, timerId);
};

export const getGameState = async (roomId: string): Promise<GameState | null> => {
  return memoryStore.getGameState(roomId);
};

export const saveGameState = (roomId: string, gameState: GameState) => {
  const stateToSave = { ...gameState, disconnectTimers: {} };
  memoryStore.saveGameState(roomId, stateToSave);
  return Promise.resolve();
};

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

export const getPublicState = (gameState: GameState) => {
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

export const changeTurn = (gameState: GameState, nextPlayerId: string, roomId: string) => {
    gameState.turn = nextPlayerId;
    broadcastToRoom(roomId, { type: 'ESTADO_ATUALIZADO', ...getPublicState(gameState) });
    startTurnTimer(roomId, gameState);
};

export function handlePlayPiece(initialGameState: GameState, userId: string, data: PlayPieceMessage, roomId: string): GameLogicResult {
    const hand = initialGameState.hands[userId];
    if (!hand) {
        return { error: 'Mão do jogador não encontrada.' };
    }

    const pieceFromClient: Domino = data.piece;
    const chosenEndId: string | undefined = data.endId;

    const pieceIndex = hand.findIndex(p =>
        (p.value1 === pieceFromClient.value1 && p.value2 === pieceFromClient.value2) ||
        (p.value1 === pieceFromClient.value2 && p.value2 === pieceFromClient.value1)
    );

    if (pieceIndex === -1) {
        return { error: 'Você não possui esta peça.' };
    }

    const pieceToPlay = { ...hand[pieceIndex] };
    const isDouble = pieceToPlay.value1 === pieceToPlay.value2;

    let newPlacedPiece: PlacedDomino;
    let nextActiveEnds: BoardEnd[];
    const pieceHeightUnits = 1; // altura de uma peça é 1 unidade (36px)
    const pieceWidthUnits = 2;  // largura de uma peça é 2 unidades (72px)

    if (initialGameState.board.length === 0) {
        const rotation = isDouble ? 90 : 0;
        newPlacedPiece = { piece: pieceToPlay, x: 0, y: 0, rotation: rotation as any };
        
        const width = isDouble ? pieceHeightUnits : pieceWidthUnits;
        const leftEndPos = -width / 2;
        const rightEndPos = width / 2;
        
        nextActiveEnds = [
            { id: `end-left`, value: pieceToPlay.value1, x: leftEndPos, y: 0, attachDirection: 180 },
            { id: `end-right`, value: pieceToPlay.value2, x: rightEndPos, y: 0, attachDirection: 0 }
        ];
    } else {
        const validPlacements = initialGameState.activeEnds.filter(end =>
            end.value === pieceToPlay.value1 || end.value === pieceToPlay.value2
        );

        if (validPlacements.length === 0) {
            return { error: 'Jogada inválida.' };
        }

        if (validPlacements.length > 1 && !chosenEndId) {
            return {
                events: [{
                    target: 'player',
                    payload: {
                        type: 'CHOOSE_PLACEMENT',
                        piece: pieceToPlay,
                        options: validPlacements.map(p => ({ endId: p.id, value: p.value }))
                    }
                }]
            };
        }

        const targetEnd = chosenEndId ? validPlacements.find(e => e.id === chosenEndId) : validPlacements[0];
        if (!targetEnd) {
            return { error: 'A ponta escolhida não é válida.' };
        }

        // --- LÓGICA DE POSICIONAMENTO E ROTAÇÃO REATORADA ---

        // 1. Determina a direção final da jogada, verificando colisões com as bordas.
        let newEndAttachDirection = targetEnd.attachDirection;
        const collisionMargin = 1.5;

        // Calcula a posição da nova ponta *se não houvesse virada* para checar colisão.
        if (newEndAttachDirection === 0 && (targetEnd.x + pieceWidthUnits > (BOARD_WIDTH_UNITS / 2) - collisionMargin)) newEndAttachDirection = 90; // Direita -> Vira para Baixo
        else if (newEndAttachDirection === 180 && (targetEnd.x - pieceWidthUnits < (-BOARD_WIDTH_UNITS / 2) + collisionMargin)) newEndAttachDirection = 270; // Esquerda -> Vira para Cima
        else if (newEndAttachDirection === 90 && (targetEnd.y + pieceWidthUnits > (BOARD_HEIGHT_UNITS / 2) - collisionMargin)) newEndAttachDirection = 180; // Baixo -> Vira para Esquerda
        else if (newEndAttachDirection === 270 && (targetEnd.y - pieceWidthUnits < (-BOARD_HEIGHT_UNITS / 2) + collisionMargin)) newEndAttachDirection = 0; // Cima -> Vira para Direita

        // 2. Determina a rotação final da peça com base na direção final e se é uma bucha.
        const finalIsHorizontal = newEndAttachDirection === 0 || newEndAttachDirection === 180;
        const rotation: 0 | 90 | 180 | 270 = isDouble
            ? (finalIsHorizontal ? 90 : 0) // Buchas são perpendiculares à linha de jogo.
            : (finalIsHorizontal ? 0 : 90); // Peças normais são paralelas.

        // 3. Determina as dimensões da peça no tabuleiro com base na sua rotação final.
        const pieceIsRotatedVertically = rotation === 90 || rotation === 270;
        const pieceWidthOnBoard = pieceIsRotatedVertically ? pieceHeightUnits : pieceWidthUnits;
        const pieceHeightOnBoard = pieceIsRotatedVertically ? pieceWidthUnits : pieceHeightUnits;
        
        // 4. Calcula a posição final da peça e da nova ponta.
        let newPieceX, newPieceY, newEndX, newEndY;
        const sign = (newEndAttachDirection === 0 || newEndAttachDirection === 90) ? 1 : -1;

        if (finalIsHorizontal) { // Jogada na horizontal (esquerda ou direita)
            const pieceCenterOffset = pieceWidthOnBoard / 2;
            newPieceX = targetEnd.x + (sign * pieceCenterOffset);
            newPieceY = targetEnd.y;
            newEndX = newPieceX + (sign * pieceCenterOffset);
            newEndY = newPieceY;
        } else { // Jogada na vertical (cima ou baixo)
            const pieceCenterOffset = pieceHeightOnBoard / 2;
            newPieceX = targetEnd.x;
            newPieceY = targetEnd.y + (sign * pieceCenterOffset);
            newEndX = newPieceX;
            newEndY = newPieceY + (sign * pieceCenterOffset);
        }

        // 5. Orienta os valores da peça para corresponder à ponta de conexão.
        const isGrowingDirection = newEndAttachDirection === 0 || newEndAttachDirection === 90;
        if (isGrowingDirection) { // Direita ou Baixo
            if (pieceToPlay.value1 !== targetEnd.value) {
                [pieceToPlay.value1, pieceToPlay.value2] = [pieceToPlay.value2, pieceToPlay.value1];
            }
        } else { // Esquerda ou Cima
            if (pieceToPlay.value2 !== targetEnd.value) {
                [pieceToPlay.value1, pieceToPlay.value2] = [pieceToPlay.value2, pieceToPlay.value1];
            }
        }
        
        // 6. Cria a nova peça posicionada e a nova ponta ativa.
        newPlacedPiece = { piece: pieceToPlay, x: newPieceX, y: newPieceY, rotation };
        const newEndValue = isGrowingDirection ? pieceToPlay.value2 : pieceToPlay.value1;
        const newEnd: BoardEnd = {
            id: `end-${Date.now()}`,
            value: newEndValue,
            x: newEndX,
            y: newEndY,
            attachDirection: newEndAttachDirection
        };

        nextActiveEnds = [...initialGameState.activeEnds.filter(e => e.id !== targetEnd.id), newEnd];
    }

    const newHand = [...hand];
    newHand.splice(pieceIndex, 1);

    const newState: GameState = {
        ...initialGameState,
        board: [...initialGameState.board, newPlacedPiece],
        activeEnds: nextActiveEnds,
        occupiedCells: { ...initialGameState.occupiedCells, [`${Math.round(newPlacedPiece.x)},${Math.round(newPlacedPiece.y)}`]: true },
        hands: {
            ...initialGameState.hands,
            [userId]: newHand
        },
        consecutivePasses: 0,
    };

    const events: GameEvent[] = [{ target: 'player', payload: { type: 'UPDATE_HAND', yourNewHand: newHand } }];
    clearTurnTimer(roomId);
    
    if (newHand.length === 0) {
        const winner = newState.players.find(p => p.id === userId)!;
        return { newState, events, terminal: { winner, reason: "O jogador bateu!" } };
    }

    if (nextActiveEnds.length < 2) {
        const passResult = handlePassTurn(newState, userId, roomId, true);
        const combinedEvents = [...events, ...(passResult.events || [])];
        return { ...passResult, events: combinedEvents };
    }

    const nextPlayerId = getNextTurn(userId, newState.players);
    changeTurn(newState, nextPlayerId, roomId);

    return { newState, events };
}

export function handleStartGame(userId: string, roomId: string): GameLogicResult {
    const room = memoryStore.getRoom(roomId);

    if (!room) {
        return { error: "Sala não encontrada." };
    }
    if (room.hostId !== userId) {
        return { error: "Apenas o dono da sala pode iniciar o jogo." };
    }
    if (room.status === 'playing') {
        return { error: "O jogo já começou." };
    }
    if (room.playerCount < MIN_PLAYERS_TO_START) {
        return { error: `São necessários pelo menos ${MIN_PLAYERS_TO_START} jogadores para iniciar.` };
    }

    startGame(roomId);

    return {};
}

export async function startGame(roomId: string) {
    console.log(`[${SERVER_ID}] Starting game in room ${roomId}`);
    const room = memoryStore.getRoom(roomId);
    if (!room) return;

    room.status = 'playing';
    room.readyPlayers.clear(); // Limpa o status de "pronto" ao iniciar um novo jogo
    memoryStore.saveRoom(roomId, room);

    broadcastToLobby({ type: 'ROOM_REMOVED', roomName: roomId });

    const playerIds = Array.from(room.players);
    const players: Player[] = [];
    for (const id of playerIds) {
        const ws = clientsByUserId.get(id);
        const username = ws?.user?.username || `User-${id}`; 
        players.push({ id, username });
    }

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

    startTurnTimer(roomId, gameState);
}

export async function endGame(roomId: string, gameState: GameState, winner: Player | null, reason: string) {
    clearTurnTimer(roomId);
    
    const winnerIdentifier = winner ? `${winner.username} (ID ${winner.id})` : 'Ninguém';
    console.log(`[${SERVER_ID}] Game over in room ${roomId}. Winner: ${winnerIdentifier}. Reason: ${reason}`);
    
    if (gameState.disconnectTimers) {
        Object.values(gameState.disconnectTimers).forEach(clearTimeout);
    }
    
    try {
        if(winner && winner.id.match(/^\d+$/)) {
            await pool.query(
                'INSERT INTO match_history (room_id, winner_id, winner_username, players) VALUES ($1, $2, $3, $4)',
                [roomId, parseInt(winner.id, 10), winner.username, JSON.stringify(gameState.players.map(p => ({id: p.id, username: p.username})))]
            );
        }
    } catch (e) { 
        console.error("Error saving match history:", e); 
    }

    const room = memoryStore.getRoom(roomId);
    const hostIsPresent = room && room.players.has(room.hostId!);

    broadcastToRoom(roomId, {
        type: 'JOGO_TERMINADO',
        winner: winner ? winner.username : 'Ninguém',
        reason,
        canRematch: hostIsPresent
    });

    if (hostIsPresent) {
        // Reset a sala para um potencial novo jogo
        console.log(`[${SERVER_ID}] Sala ${roomId} está a ser resetada para um novo jogo.`);
        memoryStore.deleteGameState(roomId);
        
        room.status = 'waiting';
        room.readyPlayers.clear();
        memoryStore.saveRoom(roomId, room);

        // Envia todos os jogadores de volta para o estado de lobby da sala
        broadcastToRoom(roomId, (clientInRoom) => {
            return {
                type: 'ROOM_STATE',
                myId: clientInRoom.user.userId,
                hostId: room.hostId,
                players: Array.from(room.players).map(id => {
                    const playerWs = clientsByUserId.get(id);
                    const username = playerWs?.user?.username || `User-${id}`;
                    return { id, username };
                }),
                readyPlayers: Array.from(room.readyPlayers),
                playerCount: room.playerCount,
                maxPlayers: MAX_PLAYERS,
                status: room.status
            };
        });
    } else {
        // O anfitrião saiu, destrói a sala
        console.log(`[${SERVER_ID}] Dono da sala ${roomId} não está presente. A sala será destruída.`);
        memoryStore.deleteGameState(roomId);
        memoryStore.deleteRoom(roomId);
    }
}

export function handlePassTurn(initialGameState: GameState, userId: string, roomId: string, forceEndCheck = false): GameLogicResult {
    const newConsecutivePasses = initialGameState.consecutivePasses + 1;
    const activePlayersCount = initialGameState.players.filter(p => !p.disconnectedSince).length;

    const newState: GameState = {
        ...initialGameState,
        consecutivePasses: newConsecutivePasses,
    };

    clearTurnTimer(roomId);

    if (forceEndCheck || newConsecutivePasses >= activePlayersCount) {
        let winner: Player | null = null;
        let minPoints = Infinity;
        
        newState.players.forEach(p => {
            if (!p.disconnectedSince) {
                const points = newState.hands[p.id]?.reduce((sum, piece) => sum + piece.value1 + piece.value2, 0) || 0;
                if (points < minPoints) {
                    minPoints = points;
                    winner = p;
                } else if (points === minPoints) {
                    winner = null;
                }
            }
        });
        
        const reason = winner ? "Jogo fechado! Vitória por menos pontos." : "Jogo fechado! Empate.";
        return { newState, terminal: { winner, reason } };
    }

    const nextPlayerId = getNextTurn(userId, newState.players);
    changeTurn(newState, nextPlayerId, roomId);
    
    return { newState };
}

export function handleLeaveGame(ws: AuthenticatedWebSocket, initialGameState: GameState, userId: string, forceRemove = false): GameLogicResult {
    const playerIndex = initialGameState.players.findIndex(p => p.id === userId);
    if (playerIndex === -1) return { newState: initialGameState };

    const leavingPlayer = initialGameState.players[playerIndex];

    const newPlayers = [...initialGameState.players];
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], disconnectedSince: Date.now() };

    const newState: GameState = {
        ...initialGameState,
        players: newPlayers,
    };

    const isCurrentTurn = newState.turn === userId;
    const roomId = memoryStore.getRoomIdFromUser(userId);
    if(isCurrentTurn && roomId) {
        clearTurnTimer(roomId);
    }
    
    const remainingPlayers = newState.players.filter(p => !p.disconnectedSince);
    let reason = `Jogador ${leavingPlayer.username || userId} ${forceRemove ? 'foi removido' : 'abandonou'}.`;

    if (remainingPlayers.length === 0) {
        reason = 'Todos os jogadores saíram.';
        return { newState, terminal: { winner: null, reason } };
    }
    
    if (isCurrentTurn && roomId) {
       const nextPlayerId = getNextTurn(userId, newState.players);
       changeTurn(newState, nextPlayerId, roomId);
    }
    
    const events: GameEvent[] = [{ target: 'broadcast', payload: { type: 'ESTADO_ATUALIZADO', ...getPublicState(newState) } }];
    return { newState, events };
}

export async function processGameLogicResult(result: GameLogicResult, roomId: string, originalGameState: GameState) {
    if (result.error && originalGameState) {
        const ws = clientsByUserId.get(originalGameState.turn);
        if (ws) sendError(ws, result.error);
        return;
    }
    
    let finalGameState = result.newState || originalGameState;
    if (!finalGameState) return; // Se não há estado, não há o que processar

    if (result.events) {
        const userIdForEvent = originalGameState.turn;
        result.events.forEach((event: any) => {
            if (event.target === 'player') {
                sendToPlayer(userIdForEvent, event.payload);
            }
            if (event.target === 'broadcast') {
                broadcastToRoom(roomId, event.payload);
            }
        });
    }
    
    if (result.terminal) {
        await endGame(roomId, finalGameState, result.terminal.winner, result.terminal.reason);
    } else if (result.newState) {
        await saveGameState(roomId, finalGameState);
    }
}

export function handlePlayerReady(userId: string, roomId: string): GameLogicResult {
    const room = memoryStore.getRoom(roomId);
    if (!room) {
        return { error: 'Sala não encontrada.' };
    }
    if (room.status === 'playing') {
        return { error: 'O jogo já está em andamento.' };
    }

    room.readyPlayers.add(userId);
    console.log(`[${SERVER_ID}] Jogador ${userId} está pronto na sala ${roomId}. Prontos: ${room.readyPlayers.size}/${room.playerCount}`);
    memoryStore.saveRoom(roomId, room);

    // Notifica todos na sala sobre a mudança de estado
    broadcastToRoom(roomId, (clientInRoom) => {
        return {
            type: 'ROOM_STATE',
            myId: clientInRoom.user.userId,
            hostId: room.hostId,
            players: Array.from(room.players).map(id => {
                const playerWs = clientsByUserId.get(id);
                const username = playerWs?.user?.username || `User-${id}`;
                return { id, username };
            }),
            readyPlayers: Array.from(room.readyPlayers),
            playerCount: room.playerCount,
            maxPlayers: MAX_PLAYERS,
            status: room.status
        };
    });

    // Verifica se todos estão prontos para iniciar o jogo
    const activePlayersCount = room.players.size;
    if (activePlayersCount >= MIN_PLAYERS_TO_START && room.readyPlayers.size === activePlayersCount) {
        console.log(`[${SERVER_ID}] Todos os jogadores estão prontos em ${roomId}. A iniciar novo jogo.`);
        startGame(roomId);
    }

    return {};
}