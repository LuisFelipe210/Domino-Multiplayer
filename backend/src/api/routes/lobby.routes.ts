import { Router } from 'express';
import { body } from 'express-validator';
import { listRooms, joinRoom, checkActiveGame } from '../controllers/lobby.controller';
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
        .isLength({min: 3, max: 20}).withMessage('O nome da sala deve ter entre 3 e 20 caracteres.')
        .trim()
        .escape(),
    handleValidationErrors, // Usando o middleware centralizado
    joinRoom
);

// Rota para verificar se o utilizador tem uma sessão ou um jogo ativo para reconectar
router.get('/rejoin', checkActiveGame);

export default router;