import { handlePlayPiece, handlePassTurn, endGame, getNextTurn, handleLeaveGame } from '../gameHandler';
import { Player, GameState } from '../../types';
import { pool } from '../../config/database';

jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(),
  }
}));

// Mock do memoryStore para isolar a lógica do jogo
jest.mock('../memoryStore', () => ({
    memoryStore: {
        getRoomIdFromUser: jest.fn().mockReturnValue('test-room'),
    }
}));


beforeEach(() => {
    (pool.query as jest.Mock).mockClear();
});

const createBaseGameState = (): GameState => {
    const players: Player[] = [
        { id: '1', username: 'Player 1' },
        { id: '2', username: 'Player 2' },
        { id: '3', username: 'Player 3' },
        { id: '4', username: 'Player 4' },
    ];
    return {
        board: [],
        activeEnds: [],
        hands: {
            '1': [], '2': [], '3': [], '4': [],
        },
        turn: '1',
        players,
        consecutivePasses: 0,
        disconnectTimers: {},
        occupiedCells: {}
    };
};

describe('Game Logic: getNextTurn', () => {
    const players: Player[] = [ { id: '1', username: 'A' }, { id: '2', username: 'B' }, { id: '3', username: 'C' } ];
    it('should return the next player in the list', () => expect(getNextTurn('1', players)).toBe('2'));
    it('should loop back to the first player from the last one', () => expect(getNextTurn('3', players)).toBe('1'));
    
    it('should skip a disconnected player', () => {
        const playersWithDisconnect: Player[] = [
            { id: '1', username: 'A' },
            { id: '2', username: 'B', disconnectedSince: Date.now() },
            { id: '3', username: 'C' },
        ];
        expect(getNextTurn('1', playersWithDisconnect)).toBe('3');
    });
});

describe('Game Logic: handlePlayPiece', () => {
  it('should return an error if the player does not have the piece', () => {
    let gameState = createBaseGameState();
    gameState.hands['1'] = [{ value1: 1, value2: 1 }];
    const moveData = { type: "PLAY_PIECE" as const, piece: { value1: 2, value2: 2 } };
    const result = handlePlayPiece(gameState, '1', moveData, 'test-room');
    expect(result.error).toBe('Você não possui esta peça.');
  });

  it('should return an error if the piece does not fit anywhere', () => {
    let gameState = createBaseGameState();
    gameState.board = [{ piece: { value1: 5, value2: 4 }, x: 0, y: 0, rotation: 0 }];
    gameState.activeEnds = [{ id: '-1,0', value: 5, x: -1, y: 0, attachDirection: 180 }, { id: '1,0', value: 4, x: 1, y: 0, attachDirection: 0 }];
    gameState.hands['1'] = [{ value1: 1, value2: 2 }]; // Peça inválida
    const result = handlePlayPiece(gameState, '1', { type: "PLAY_PIECE" as const, piece: { value1: 1, value2: 2 } }, 'test-room');
    expect(result.error).toBe('Jogada inválida.');
  });
  
  it('should ask to choose a placement if a piece fits on multiple ends', () => {
    let gameState = createBaseGameState();
    gameState.board = [{ piece: { value1: 5, value2: 4 }, x: 0, y: 0, rotation: 0 }];
    gameState.activeEnds = [{ id: '-1,0', value: 5, x: -1, y: 0, attachDirection: 180 }, { id: '1,0', value: 4, x: 1, y: 0, attachDirection: 0 }];
    gameState.hands['1'] = [{ value1: 5, value2: 4 }];
    const result = handlePlayPiece(gameState, '1', { type: "PLAY_PIECE" as const, piece: { value1: 5, value2: 4 } }, 'test-room');
    
    expect(result.events?.[0].payload.type).toBe('CHOOSE_PLACEMENT');
    expect(result.events?.[0].payload.options).toHaveLength(2);
  });

  it('should end the game if a player plays their last piece', () => {
    let gameState = createBaseGameState();
    gameState.hands['1'] = [{ value1: 6, value2: 6 }];
    const result = handlePlayPiece(gameState, '1', { type: "PLAY_PIECE" as const, piece: { value1: 6, value2: 6 } }, 'test-room');
    expect(result.terminal).toBeDefined();
    expect(result.terminal?.winner?.id).toBe('1');
  });
});

describe('Game Logic: handlePassTurn', () => {
    it('should end the game if all active players pass consecutively', () => {
        let gameState = createBaseGameState();
        gameState.consecutivePasses = 3; 
        gameState.hands = {
            '1': [{ value1: 6, value2: 6}], // 12 pontos
            '2': [{ value1: 5, value2: 5}], // 10 pontos
            '3': [{ value1: 4, value2: 4}], // 8 pontos
            '4': [{ value1: 0, value2: 1}], // 1 ponto (futuro vencedor)
        };
        const result = handlePassTurn(gameState, '4', 'test-room');
        expect(result.terminal).toBeDefined();
        expect(result.terminal?.winner?.id).toBe('4');
        expect(result.terminal?.reason).toContain('Vitória por menos pontos');
    });
});

describe('Game Logic: handleLeaveGame', () => {
    const mockWs = {} as any;

    it('should pass the turn to the next player if the current player leaves', () => {
        let gameState = createBaseGameState();
        gameState.turn = '2';
        const result = handleLeaveGame(mockWs, gameState, '2', false);
        expect(result.newState?.turn).toBe('3');
        expect(result.terminal).toBeUndefined();
    });

    it('should declare the last remaining player the winner', () => {
        let gameState = createBaseGameState();
        gameState.players[2].disconnectedSince = Date.now();
        gameState.players[3].disconnectedSince = Date.now();
        const result = handleLeaveGame(mockWs, gameState, '1', false);
        expect(result.terminal).toBeDefined();
        expect(result.terminal?.winner?.id).toBe('2');
    });

    it('should end the game with no winner if the last active player leaves', () => {
        let gameState = createBaseGameState();
        gameState.players[0].disconnectedSince = Date.now();
        gameState.players[2].disconnectedSince = Date.now();
        gameState.players[3].disconnectedSince = Date.now();
        const result = handleLeaveGame(mockWs, gameState, '2', false); 
        expect(result.terminal).toBeDefined();
        expect(result.terminal?.winner).toBeNull();
    });
});

describe('Game Logic: endGame', () => {
    it('should call database query for a valid winner', async () => {
        const winner: Player = { id: '123', username: 'The Winner' };
        let gameState = createBaseGameState();
        gameState.players.push(winner);
        
        await endGame('test-room', gameState, winner, 'Vitória por pontos');

        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO match_history'),
            expect.arrayContaining([123, 'The Winner'])
        );
    });

    it('should not call database query if there is no winner', async () => {
        let gameState = createBaseGameState();
        
        await endGame('test-room', gameState, null, 'Empate');

        expect(pool.query).not.toHaveBeenCalled();
    });
});