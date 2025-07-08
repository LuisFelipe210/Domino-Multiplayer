import { GameState, Room } from '../types';

const gameStates = new Map<string, GameState>();
const rooms = new Map<string, Room>();
const userToRoomMap = new Map<string, string>(); // Mapeia userId -> roomId

export const memoryStore = {
    // Funções para gerenciar o estado do jogo
    getGameState: (roomId: string) => gameStates.get(roomId) || null,
    saveGameState: (roomId: string, state: GameState) => gameStates.set(roomId, state),
    deleteGameState: (roomId: string) => gameStates.delete(roomId),
    
    // Funções para gerenciar as salas
    getRoom: (roomId: string) => rooms.get(roomId) || null,
    saveRoom: (roomId: string, room: Room) => {
        // Garantir que o set de jogadores prontos sempre exista
        if (!room.readyPlayers) {
            room.readyPlayers = new Set<string>();
        }
        rooms.set(roomId, room)
    },
    getAllRooms: () => Array.from(rooms.values()),
    deleteRoom: (roomId: string) => {
        const room = rooms.get(roomId);
        if (room) {
            // Remove o vínculo de todos os jogadores da sala
            room.players.forEach(userId => userToRoomMap.delete(userId));
            rooms.delete(roomId);
        }
    },

    // Funções para gerenciar a relação entre usuário e sala
    setUserRoom: (userId: string, roomId: string) => userToRoomMap.set(userId, roomId),
    
    // Função para obter a sala de um usuário
    getRoomIdFromUser: (userId: string) => userToRoomMap.get(userId) || null,
    
    // Função que estava a faltar: remover um usuário de uma sala
    deleteUserFromRoom: (userId: string, roomId: string) => {
        const room = rooms.get(roomId);
        if (room) {
            room.players.delete(userId);
            room.playerCount = room.players.size;
        }
        userToRoomMap.delete(userId);
    }
};

export { Room };
