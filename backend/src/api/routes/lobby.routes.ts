import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { listRooms, joinRoom, rejoinGame } from '../controllers/lobby.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Middleware para lidar com os resultados da validação (pode ser reutilizado ou movido para um ficheiro separado)
const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

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
    handleValidationErrors,
    joinRoom
);

// Nova rota para tentar reconectar a um jogo existente
router.get('/rejoin', rejoinGame);

export default router;