import {
  startGame,
  handlePlayPiece,
  endGame,
  saveGameState
} from '../gameHandler';
import { redisClient } from '../../config/redis';
import { pool } from '../../config/database';
import { Player, GameState } from '../../types';

jest.mock('../../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    publish: jest.fn(),
    hDel: jest.fn(),
    del: jest.fn(),
    sRem: jest.fn(),
    hSet: jest.fn(),
    sMembers: jest.fn(),
  }
}));

jest.mock('../../config/database', () => ({
  pool: {
    query: jest.fn(),
  }
}));

jest.mock('../gameUtils', () => ({
  sendToPlayer: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const players: Player[] = [
  { id: '1', username: 'Alice' },
  { id: '2', username: 'Bob' },
  { id: '3', username: 'Carol' },
  { id: '4', username: 'Dave' },
];

// Estado controlado com 4 jogadores e mãos
const forceGameState = (): GameState => ({
  board: [],
  activeEnds: [],
  hands: {
    '1': [{ value1: 6, value2: 6 }],  // Alice vai jogar essa peça para vencer
    '2': [{ value1: 6, value2: 1 }, { value1: 1, value2: 1 }],
    '3': [{ value1: 2, value2: 3 }],
    '4': [{ value1: 4, value2: 5 }]
  },
  turn: '1',
  players,
  consecutivePasses: 0,
  disconnectTimers: {},
  occupiedCells: {}
});

describe('Integração: Partida completa simulada 4 jogadores', () => {
  it('simula jogo com 4 jogadores e vitória do player 1', async () => {
    (redisClient.sMembers as jest.Mock).mockResolvedValue(players.map(p => p.id));
    (redisClient.get as jest.Mock).mockImplementation((key: string) => {
      const user = players.find(p => key === `user:${p.id}:username`);
      return Promise.resolve(user?.username || null);
    });
    (redisClient.set as jest.Mock).mockResolvedValue('OK');

    // Start do jogo
    await startGame('room-4players');

    expect(redisClient.set).toHaveBeenCalledWith(
      'game_state:room-4players',
      expect.stringContaining('"turn":"1"')
    );

    // Força estado controlado
    const gameState = forceGameState();
    await saveGameState('room-4players', gameState);

    // player 1 joga a peça que vence o jogo
    const playResult = handlePlayPiece(gameState, '1', {
      piece: { value1: 6, value2: 6 },
      type: 'PLAY_PIECE'
    });

    expect(playResult.terminal).toBeDefined();
    expect(playResult.terminal?.winner?.id).toBe('1');
    expect(playResult.terminal?.reason).toMatch(/bateu/i);

    // Finaliza o jogo
    await endGame('room-4players', gameState, players[0], playResult.terminal?.reason || 'Vitória');

    expect(
      (redisClient.del as jest.Mock).mock.calls.some(
        (call: any[]) => Array.isArray(call[0]) && call[0].includes('game_state:room-4players')
      )
    ).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO match_history'),
      expect.arrayContaining([expect.any(String), 'Alice'])
    );
    expect(redisClient.publish).toHaveBeenCalledWith(
      'game-events',
      expect.stringContaining('JOGO_TERMINADO')
    );
  });
});