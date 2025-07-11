// projeto-domino/backend/src/api/controllers/lobby.controller.ts
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { MAX_PLAYERS } from '../../config/gameConfig';
import { memoryStore, Room } from '../../websockets/memoryStore';

export const listRooms = async (req: Request, res: Response) => {
    try {
        const allRooms = memoryStore.getAllRooms();
        const publicRooms = allRooms
            .map(room => ({
                name: room.name,
                playerCount: room.playerCount,
                maxPlayers: MAX_PLAYERS,
                hasPassword: room.hasPassword,
                status: room.status, // Adicionado o status para o frontend poder diferenciar
            }));
        res.json({ rooms: publicRooms });
    } catch (error) {
        console.error("Erro ao listar salas:", error);
        res.status(500).json({ message: 'Erro ao obter lista de salas.' });
    }
};

export const joinRoom = async (req: Request, res: Response) => {
    const { roomName, password } = req.body;
    
    if (!roomName) {
        return res.status(400).json({ message: 'O nome da sala é obrigatório.' });
    }

    try {
        let room = memoryStore.getRoom(roomName);

        if (!room) {
            console.log(`[Lobby API] Utilizador ID ${req.user!.userId} a criar nova sala: ${roomName}`);
            const newRoom: Room = {
                name: roomName,
                playerCount: 0,
                status: 'waiting',
                players: new Set(),
                hasPassword: !!password,
                hostId: String(req.user!.userId),
                readyPlayers: new Set(),
            };
            if (password) {
                newRoom.passwordHash = await bcrypt.hash(password, 10);
            }
            memoryStore.saveRoom(roomName, newRoom);
            room = newRoom;
        } else {
            // Se a sala estiver jogando e o usuário não for um jogador existente (tentando reconectar)
            // ele não deve poder entrar.
            if (room.status === 'playing' && !room.players.has(String(req.user!.userId))) {
                 return res.status(403).json({ message: 'Não é possível entrar em um jogo já em andamento.' });
            }
            if (room.status !== 'playing' && room.playerCount >= MAX_PLAYERS) { // Só impede se não estiver jogando e cheia
                return res.status(403).json({ message: 'A sala está cheia.' });
            }
            if (room.passwordHash) {
                if (!password) {
                    return res.status(401).json({ message: 'Senha incorreta.' });
                }
                const isCorrect = await bcrypt.compare(password, room.passwordHash);
                if (!isCorrect) {
                    return res.status(401).json({ message: 'Senha incorreta.' });
                }
            }
        }
        
        const protocol = req.protocol === 'https' ? 'wss' : 'ws';
        const gameServerUrl = `${protocol}://${req.get('host')}/ws/game/${encodeURIComponent(roomName)}`;
        
        res.json({ success: true, gameServerUrl });

    } catch (error) {
        console.error("Erro em joinRoom:", error);
        res.status(500).json({ message: 'Erro interno ao processar a sala.' });
    }
};

export const checkActiveGame = async (req: Request, res: Response) => {
    const userId = String(req.user!.userId);
    const username = req.user!.username;
    
    try {
        const roomId = memoryStore.getRoomIdFromUser(userId);
        
        // Verifica se o usuário está mapeado para uma sala E se essa sala tem um estado de jogo ativo
        if (roomId && memoryStore.getGameState(roomId)) {
            console.log(`[Rejoin API] Utilizador ID ${userId} encontrado no jogo ativo ${roomId}.`);
            const protocol = req.protocol === 'https' ? 'wss' : 'ws';
            const gameServerUrl = `${protocol}://${req.get('host')}/ws/game/${encodeURIComponent(roomId)}`;
            
            return res.json({ 
                active_game: true, 
                gameServerUrl, 
                user: { userId, username } 
            });
        }
        
        // Se não houver jogo ativo, apenas retorna a informação do usuário logado
        return res.json({ active_game: false, user: { userId, username } });

    } catch (error) {
        console.error(`Erro ao tentar reconectar utilizador ${userId}:`, error);
        res.status(500).json({ message: 'Erro ao verificar jogo ativo.' });
    }
};