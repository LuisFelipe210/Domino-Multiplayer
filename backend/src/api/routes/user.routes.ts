import { Router } from 'express';
import { getMatchHistory } from '../controllers/user.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Aplica o middleware de autenticação a todas as rotas deste ficheiro
router.use(authMiddleware);

// Rota para obter o histórico de partidas do utilizador logado
router.get('/history', getMatchHistory);

export default router;