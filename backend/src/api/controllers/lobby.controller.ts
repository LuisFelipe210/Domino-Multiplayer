// backend/src/api/controllers/lobby.controller.ts
import { Request, Response } from 'express';
import { redisClient } from '../../config/redis';
import bcrypt from 'bcrypt';

const PLAYERS_TO_START_GAME = 2; // Pode vir de uma configuração

// Função para listar as salas disponíveis
export const listRooms = async (req: Request, res: Response) => {
    try {
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
        res.json({ rooms });
    } catch (error) {
        console.error("Erro ao listar salas:", error);
        res.status(500).json({ message: 'Erro ao obter lista de salas.' });
    }
};

// Função para criar ou entrar numa sala
export const joinRoom = async (req: Request, res: Response) => {
    const { roomName, password } = req.body;
    if (!roomName) {
        return res.status(400).json({ message: 'O nome da sala é obrigatório.' });
    }

    const lock = await redisClient.set(`lock:room:${roomName}`, '1', { NX: true, EX: 5 });
    if (!lock) {
        return res.status(409).json({ message: 'A sala está a ser processada, tente novamente em segundos.' });
    }

    try {
        let roomData = await redisClient.hGetAll(`room:${roomName}`);
        let serverId = roomData.serverId;

        if (!serverId) { // Criar sala
            console.log(`[Lobby API] A criar nova sala: ${roomName}`);
            serverId = await redisClient.sRandMember('available_game_servers');
            if (!serverId) {
                return res.status(503).json({ message: 'Nenhum servidor de jogo disponível.' });
            }
            const roomDetails: any = { serverId, playerCount: '0', status: 'waiting' };
            if (password) {
                roomDetails.passwordHash = await bcrypt.hash(password, 10);
            }
            await redisClient.hSet(`room:${roomName}`, roomDetails);
            await redisClient.sAdd('active_rooms_set', roomName);
        } else { // Entrar em sala existente
            if (roomData.passwordHash) {
                const isCorrect = await bcrypt.compare(password || '', roomData.passwordHash);
                if (!isCorrect) {
                    return res.status(401).json({ message: 'Senha incorreta.' });
                }
            }
            if (parseInt(roomData.playerCount, 10) >= PLAYERS_TO_START_GAME) {
                return res.status(403).json({ message: 'A sala está cheia.' });
            }
        }
        
        const gameServerUrl = `ws://${req.headers.host}/ws/game/${serverId}/${roomName}`;
        res.json({ success: true, gameServerUrl });
    } catch (error) {
        console.error("Erro em joinRoom:", error);
        res.status(500).json({ message: 'Erro interno ao processar a sala.' });
    } finally {
        await redisClient.del(`lock:room:${roomName}`);
    }
};
