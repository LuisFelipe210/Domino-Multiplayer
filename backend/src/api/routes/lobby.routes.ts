// backend/src/api/routes/lobby.routes.ts
import { Router } from 'express';
import { listRooms, joinRoom } from '../controllers/lobby.controller';

const router = Router();

// Rota para obter a lista de salas
router.get('/rooms', listRooms);

// Rota para criar/entrar numa sala
router.post('/rooms', joinRoom);

export default router;
