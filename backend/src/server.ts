// backend/src/server.ts

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import url from 'url';

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 4000;
const SERVER_ID = process.env.SERVER_ID || 'default-server';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
const PLAYERS_TO_START_GAME = 2;
const RECONNECTION_TIMEOUT_MS = 30000; // 30 segundos para reconectar

const app = express();
app.use(express.json());
const server = http.createServer(app);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error(`[${SERVER_ID}] Redis Client Error`, err));

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

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const newUser = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, passwordHash]);
    res.status(201).json(newUser.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registar utilizador. O utilizador já pode existir.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ message: 'Credenciais inválidas.' });
        const user = userResult.rows[0];
        const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordCorrect) return res.status(401).json({ message: 'Credenciais inválidas.' });
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

// --- SERVIDOR WEBSOCKET ---
const wss = new WebSocketServer({ noServer: true });
const activeRooms = new Map<string, Set<WebSocket>>();
const lobbyClients = new Set<WebSocket>();

// --- FUNÇÕES DE BROADCAST ---
function broadcastToLobby(message: object) {
    const stringifiedMessage = JSON.stringify(message);
    lobbyClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(stringifiedMessage);
    });
}
function broadcastToRoom(roomId: string, message: object) {
    const room = activeRooms.get(roomId);
    if (room) {
        const stringifiedMessage = JSON.stringify(message);
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(stringifiedMessage);
        });
    }
}
async function broadcastRoomList() {
    const roomNames = await redisClient.sMembers('active_rooms_set');
    const rooms = [];
    for (const name of roomNames) {
        const roomData = await redisClient.hGetAll(`room:${name}`);
        if (roomData.status !== 'playing') {
            rooms.push({
                name: name,
                playerCount: parseInt(roomData.playerCount || '0', 10),
                maxPlayers: PLAYERS_TO_START_GAME,
                hasPassword: !!roomData.passwordHash,
            });
        }
    }
    broadcastToLobby({ type: 'ROOM_LIST', rooms });
}

// --- LÓGICA DE JOGO ---
async function startGame(roomId: string) {
    console.log(`[${SERVER_ID}] A tentar iniciar o jogo na sala ${roomId}...`);
    const playersInRoom = Array.from(activeRooms.get(roomId)!);
    
    let dominoSet = createDominoSet();
    dominoSet = shuffle(dominoSet);

    const gameState: GameState = {
        board: [],
        hands: {},
        boneyard: [],
        turn: (playersInRoom[0] as any).user.id,
        players: [],
        consecutivePasses: 0,
    };

    playersInRoom.forEach((ws) => {
        const user = (ws as any).user;
        gameState.players.push({ id: user.id, username: user.username });
        gameState.hands[user.id] = dominoSet.splice(0, 7);
    });

    gameState.boneyard = dominoSet;

    await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));
    console.log(`[${SERVER_ID}] Estado do jogo para a sala ${roomId} guardado no Redis.`);

    playersInRoom.forEach(ws => {
        const user = (ws as any).user;
        const personalState = {
            type: 'JOGO_INICIADO',
            yourHand: gameState.hands[user.id],
            gameState: {
                board: gameState.board,
                turn: gameState.turn,
                players: gameState.players,
                boneyardSize: gameState.boneyard.length,
            }
        };
        ws.send(JSON.stringify(personalState));
    });
}

async function endGame(roomId: string, gameState: GameState, winner: {id: string, username: string}, reason: string) {
    console.log(`[${SERVER_ID}] Jogo na sala ${roomId} terminado. Vencedor: ${winner.username}. Motivo: ${reason}`);

    broadcastRoom(roomId, {
        type: 'JOGO_TERMINADO',
        winner: winner.username,
        reason: reason,
        finalState: gameState
    });

    try {
        await pool.query(
            'INSERT INTO match_history (room_id, winner_id, winner_username, players) VALUES ($1, $2, $3, $4)',
            [roomId, winner.id, winner.username, JSON.stringify(gameState.players)]
        );
        console.log(`[${SERVER_ID}] Resultado da sala ${roomId} guardado na base de dados.`);
    } catch (error) {
        console.error(`[${SERVER_ID}] Erro ao guardar o histórico da partida:`, error);
    }

    await redisClient.del(`game_state:${roomId}`);
    await redisClient.del(`room:${roomId}`);
    await redisClient.sRem('active_rooms_set', roomId);
    const roomClients = activeRooms.get(roomId);
    roomClients?.forEach(ws => ws.close(1000, "Jogo terminado"));
    activeRooms.delete(roomId);
    broadcastRoomList();
}

function getNextTurn(currentPlayerId: string, players: Player[]): string {
    const activePlayers = players.filter(p => !p.disconnectedSince);
    const currentPlayerIndex = activePlayers.findIndex(p => p.id === currentPlayerId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
    return activePlayers[nextPlayerIndex].id;
}


// --- LÓGICA DE CONEXÃO ---
wss.on('connection', (ws: WebSocket, request, user, pathname) => {
    (ws as any).user = user;
    (ws as any).pathname = pathname;

    if (pathname === '/ws/lobby') {
        lobbyClients.add(ws);
        console.log(`[${SERVER_ID}] Utilizador ${user.username} entrou no lobby. Clientes no lobby: ${lobbyClients.size}`);
    } else if (pathname.startsWith('/ws/game/')) {
        const roomId = pathname.split('/').pop()!;
        if (!activeRooms.has(roomId)) activeRooms.set(roomId, new Set());
        activeRooms.get(roomId)!.add(ws);
        
        redisClient.hIncrBy(`room:${roomId}`, 'playerCount', 1).then(() => {
            broadcastRoomList();
        });

        console.log(`[${SERVER_ID}] Utilizador ${user.username} entrou na sala ${roomId}. Jogadores: ${activeRooms.get(roomId)!.size}`);
        if (activeRooms.get(roomId)!.size === PLAYERS_TO_START_GAME) {
            redisClient.hSet(`room:${roomId}`, 'status', 'playing').then(() => {
                broadcastRoomList();
                startGame(roomId);
            });
        }
    }

    ws.on('message', async (message) => {
        let data;
        try { data = JSON.parse(message.toString()); } catch (e) { return; }
        
        const currentUser = (ws as any).user;

        if ((ws as any).pathname === '/ws/lobby') {
            switch (data.type) {
                case 'LIST_ROOMS':
                    broadcastRoomList();
                    break;
                case 'JOIN_ROOM':
                    const { roomName, password } = data;
                    if (!roomName) return;

                    // Melhoria 1: Lógica de Lock para evitar Race Conditions
                    const lock = await redisClient.set(`lock:room:${roomName}`, '1', { NX: true, EX: 5 });
                    if (!lock) {
                        ws.send(JSON.stringify({ type: 'ERRO', message: 'A sala está ocupada, tente novamente.' }));
                        return;
                    }

                    try {
                        let roomData = await redisClient.hGetAll(`room:${roomName}`);
                        let serverId = roomData.serverId;

                        if (!serverId) { // Criar sala
                            serverId = await redisClient.sRandMember('available_game_servers');
                            if (!serverId) {
                                ws.send(JSON.stringify({ type: 'ERRO', message: 'Nenhum servidor disponível.' }));
                                return;
                            }
                            const roomDetails: any = { serverId, playerCount: '0', status: 'waiting' };
                            if (password) {
                                roomDetails.passwordHash = await bcrypt.hash(password, 10);
                            }
                            await redisClient.hSet(`room:${roomName}`, roomDetails);
                            await redisClient.sAdd('active_rooms_set', roomName);
                            await broadcastRoomList();
                        } else { // Entrar em sala existente
                            if (roomData.passwordHash) {
                                const isCorrect = await bcrypt.compare(password || '', roomData.passwordHash);
                                if (!isCorrect) {
                                    ws.send(JSON.stringify({ type: 'ERRO', message: 'Senha incorreta.' }));
                                    return;
                                }
                            }
                            if (parseInt(roomData.playerCount, 10) >= PLAYERS_TO_START_GAME) {
                                ws.send(JSON.stringify({ type: 'ERRO', message: 'A sala está cheia.' }));
                                return;
                            }
                        }
                        
                        const gameServerUrl = `ws://${(request as any).headers.host}/ws/game/${serverId}/${roomName}`;
                        ws.send(JSON.stringify({ type: 'SALA_INFO', gameServerUrl }));
                    } finally {
                        await redisClient.del(`lock:room:${roomName}`);
                    }
                    break;
            }
        } else if ((ws as any).pathname.startsWith('/ws/game/')) {
            const roomId = (ws as any).pathname.split('/').pop()!;
            const gameStateRaw = await redisClient.get(`game_state:${roomId}`);
            if (!gameStateRaw) return;
            const gameState: GameState = JSON.parse(gameStateRaw);

            if (gameState.turn !== currentUser.id && ['PLAY_PIECE', 'DRAW_PIECE', 'PASS_TURN'].includes(data.type)) {
                ws.send(JSON.stringify({ type: 'ERRO', message: 'Não é a sua vez.' }));
                return;
            }
            
            let shouldBroadcast = true;

            switch (data.type) {
                case 'PLAY_PIECE':
                    const pieceToPlay: Domino = data.piece;
                    const { placement } = data; // 'left' ou 'right'
                    const hand = gameState.hands[currentUser.id];
                    const pieceIndex = hand.findIndex(p => 
                        (p.value1 === pieceToPlay.value1 && p.value2 === pieceToPlay.value2) ||
                        (p.value1 === pieceToPlay.value2 && p.value2 === pieceToPlay.value1)
                    );

                    if (pieceIndex === -1) {
                        ws.send(JSON.stringify({ type: 'ERRO', message: 'Você não tem essa peça.' }));
                        return;
                    }

                    // Melhoria 2: Lógica de Escolha de Jogada
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
                    } else { // placement === 'right' or default
                        if(pieceToPlay.value1 === rightEnd) gameState.board.push(pieceToPlay);
                        else gameState.board.push({ value1: pieceToPlay.value2, value2: pieceToPlay.value1 });
                    }


                    if (hand.length === 0) {
                        endGame(roomId, gameState, currentUser, "O jogador bateu!");
                        return;
                    }

                    gameState.turn = getNextTurn(currentUser.id, gameState.players);
                    gameState.consecutivePasses = 0;
                    break;

                case 'DRAW_PIECE':
                    if (gameState.boneyard.length === 0) {
                        ws.send(JSON.stringify({ type: 'ERRO', message: 'O dormitório está vazio.' }));
                        return;
                    }
                    const newPiece = gameState.boneyard.pop()!;
                    gameState.hands[currentUser.id].push(newPiece);
                    
                    ws.send(JSON.stringify({ type: 'NOVA_PECA', yourNewHand: gameState.hands[currentUser.id] }));
                    shouldBroadcast = true;
                    break;

                case 'PASS_TURN':
                    console.log(`[${SERVER_ID}] Jogador ${currentUser.username} passou a vez.`);
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

                    gameState.turn = getNextTurn(currentUser.id, gameState.players);
                    break;
            }

            if (shouldBroadcast) {
                await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));
                const publicGameState = {
                    type: 'ESTADO_ATUALIZADO',
                    board: gameState.board,
                    turn: gameState.turn,
                    players: gameState.players,
                    boneyardSize: gameState.boneyard.length,
                };
                broadcastToRoom(roomId, publicGameState);
            } else {
                await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));
            }
        }
    });

    ws.on('close', async () => {
        const user = (ws as any).user;
        if ((ws as any).pathname === '/ws/lobby') {
            lobbyClients.delete(ws);
            console.log(`[${SERVER_ID}] Utilizador ${user.username} saiu do lobby.`);
        } else if ((ws as any).pathname.startsWith('/ws/game/')) {
            const roomId = (ws as any).pathname.split('/').pop()!;
            const room = activeRooms.get(roomId);
            if (room) {
                room.delete(ws);
                
                // Melhoria 3: Lógica de Desconexão
                const gameStateRaw = await redisClient.get(`game_state:${roomId}`);
                if (gameStateRaw) { // O jogo está a decorrer
                    const gameState: GameState = JSON.parse(gameStateRaw);
                    const player = gameState.players.find(p => p.id === user.id);
                    if (player) {
                        player.disconnectedSince = Date.now();
                        await redisClient.set(`game_state:${roomId}`, JSON.stringify(gameState));
                        broadcastToRoom(roomId, { type: 'PLAYER_DISCONNECTED', userId: user.id });
                        console.log(`[${SERVER_ID}] Jogador ${user.username} desconectado da sala ${roomId}. A aguardar reconexão.`);
                        
                        // Lógica de limpeza se o jogador não se reconectar
                        setTimeout(async () => {
                            const currentStateRaw = await redisClient.get(`game_state:${roomId}`);
                            if(!currentStateRaw) return;
                            const currentState: GameState = JSON.parse(currentStateRaw);
                            const disconnectedPlayer = currentState.players.find(p => p.id === user.id);
                            if(disconnectedPlayer && disconnectedPlayer.disconnectedSince) {
                                console.log(`[${SERVER_ID}] Tempo de reconexão para ${user.username} expirou. A remover da partida.`);
                                // Aqui poderia terminar o jogo ou continuar com um jogador a menos.
                                // Por simplicidade, vamos terminar o jogo.
                                const winner = currentState.players.find(p => p.id !== user.id)!;
                                endGame(roomId, currentState, winner, `O jogador ${user.username} abandonou a partida.`);
                            }
                        }, RECONNECTION_TIMEOUT_MS);
                    }
                } else { // O jogo ainda não começou
                    await redisClient.hIncrBy(`room:${roomId}`, 'playerCount', -1);
                    broadcastRoomList();
                }
            }
        }
    });
});

// --- FUNÇÃO DE INICIALIZAÇÃO E UPGRADE ---
server.on('upgrade', (request, socket, head) => {
  const { pathname, query } = url.parse(request.url!, true);
  const token = query.token as string;

  if (pathname?.startsWith('/ws/')) {
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, decoded, pathname);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  } else {
    socket.destroy();
  }
});

async function startServer() {
    const connectWithRetry = async (serviceName: string, connectFn: () => Promise<any>) => {
        const maxRetries = 10;
        const retryDelay = 3000; // 3 segundos
        for (let i = 0; i < maxRetries; i++) {
            try {
                await connectFn();
                console.log(`[${SERVER_ID}] Conectado ao ${serviceName} com sucesso.`);
                return;
            } catch (err: any) {
                console.error(`[${SERVER_ID}] Falha ao conectar ao ${serviceName} (tentativa ${i + 1}/${maxRetries}):`, err.message);
                if (i === maxRetries - 1) throw err;
                await new Promise(res => setTimeout(res, retryDelay));
            }
        }
    };

    try {
        await connectWithRetry('Redis', () => redisClient.connect());
        await connectWithRetry('PostgreSQL', () => pool.query('SELECT NOW()'));

        await redisClient.sAdd('available_game_servers', SERVER_ID);
        console.log(`[${SERVER_ID}] Servidor registado como disponível no Redis.`);

        server.listen(PORT, () => {
            console.log(`Backend server '${SERVER_ID}' iniciado na porta ${PORT}`);
        });
    } catch (error) {
        console.error(`[${SERVER_ID}] FALHA CRÍTICA AO INICIAR O SERVIDOR APÓS VÁRIAS TENTATIVAS:`, error);
        process.exit(1);
    }
}

startServer();
