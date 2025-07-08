import { Router } from 'express';
import { body } from 'express-validator';
import { listRooms, joinRoom, rejoinGame } from '../controllers/lobby.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { handleValidationErrors } from '../middleware/validation.middleware';

const router = Router();

// O middleware de autenticação é aplicado a todas as rotas deste ficheiro
router.use(authMiddleware);

// Rota para obter a lista de salas
router.get('/rooms', listRooms);

// Adiciona validador para a rota de criação/entrada em salas
router.post(
    '/rooms', 
    body('roomName')
        .notEmpty().withMessage('O nome da sala é obrigatório.')
        .trim()
        .escape(),
    handleValidationErrors, // Usando o middleware centralizado
    joinRoom
);

// Nova rota para tentar reconectar a um jogo existente
router.get('/rejoin', rejoinGame);

export default router;