import { Request, Response } from 'express';
import { redisClient } from '../../config/redis';
import bcrypt from 'bcrypt';
import { PLAYERS_TO_START_GAME, LOCK_EXPIRATION } from '../../config/gameConfig';

// Função para listar as salas disponíveis (pública)
export const listRooms = async (req: Request, res: Response) => {
    try {
        const publicRoomsData = await redisClient.hGetAll('public_rooms');
        
        const rooms = Object.entries(publicRoomsData).map(([name, data]) => {
            const roomInfo = JSON.parse(data);
            return {
                name,
                playerCount: roomInfo.playerCount,
                maxPlayers: PLAYERS_TO_START_GAME,
                hasPassword: roomInfo.hasPassword,
            };
        });

        res.json({ rooms });
    } catch (error) {
        console.error("Erro ao listar salas:", error);
        res.status(500).json({ message: 'Erro ao obter lista de salas.' });
    }
};

// Função para criar ou entrar numa sala (protegida por autenticação)
export const joinRoom = async (req: Request, res: Response) => {
    const { roomName, password } = req.body;
    // A validação de 'roomName' já é feita pelo express-validator, mas mantemos por segurança.
    if (!roomName) {
        return res.status(400).json({ message: 'O nome da sala é obrigatório.' });
    }

    const lockKey = `lock:room:${roomName}`;
    const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRATION });
    
    if (!lock) {
        return res.status(409).json({ message: 'A sala está a ser processada, tente novamente em segundos.' });
    }

    try {
        const roomExists = await redisClient.sIsMember('active_rooms_set', roomName);

        if (!roomExists) {
            // Se a sala não existe, cria-a.
            console.log(`[Lobby API] Utilizador ID ${req.user.userId} a criar nova sala: ${roomName}`);
            const roomDetails: any = { 
                playerCount: '0', 
                status: 'waiting' 
            };
            if (password) {
                roomDetails.passwordHash = await bcrypt.hash(password, 10);
            }
            await redisClient.hSet(`room:${roomName}`, roomDetails);
            await redisClient.sAdd('active_rooms_set', roomName);

            const publicRoomDetails = {
                playerCount: 0,
                hasPassword: !!password
            };
            await redisClient.hSet('public_rooms', roomName, JSON.stringify(publicRoomDetails));
            
        } else {
            // Se a sala já existe, valida as condições para entrar.
            const roomData = await redisClient.hGetAll(`room:${roomName}`);
            
            if (roomData.status === 'playing') {
                return res.status(403).json({ message: 'O jogo nesta sala já começou.' });
            }
            if (roomData.passwordHash) {
                const isCorrect = await bcrypt.compare(password || '', roomData.passwordHash);
                if (!isCorrect) {
                    return res.status(401).json({ message: 'Senha incorreta.' });
                }
            }
            const playerCount = await redisClient.sCard(`room:players:${roomName}`);
            if (playerCount >= PLAYERS_TO_START_GAME) {
                return res.status(403).json({ message: 'A sala está cheia.' });
            }
        }
        
        // Se todas as validações passaram, gera a URL do WebSocket.
        const protocol = req.protocol === 'https' ? 'wss' : 'ws';
        const gameServerUrl = `${protocol}://${req.get('host')}/ws/game/${roomName}`;
        
        res.json({ success: true, gameServerUrl });

    } catch (error) {
        console.error("Erro em joinRoom:", error);
        res.status(500).json({ message: 'Erro interno ao processar a sala.' });
    } finally {
        // Liberta o lock, independentemente do que acontecer.
        await redisClient.del(lockKey);
    }
};

// Função para reconexão (protegida por autenticação)
export const rejoinGame = async (req: Request, res: Response) => {
    const userId = req.user.userId;
    
    try {
        const roomId = await redisClient.get(`user:active_game:${userId}`);
        if (!roomId) {
            return res.json({ active_game: false });
        }

        const gameState = await redisClient.get(`game_state:${roomId}`);
        if (!gameState) {
            await redisClient.del(`user:active_game:${userId}`);
            return res.json({ active_game: false });
        }

        console.log(`[Rejoin API] Utilizador ID ${req.user.userId} encontrado no jogo ativo ${roomId}.`);
        const protocol = req.protocol === 'https' ? 'wss' : 'ws';
        const gameServerUrl = `${protocol}://${req.get('host')}/ws/game/${roomId}`;
        
        res.json({ active_game: true, gameServerUrl });

    } catch (error) {
        console.error(`Erro ao tentar reconectar utilizador ${userId}:`, error);
        res.status(500).json({ message: 'Erro ao verificar jogo ativo.' });
    }
};