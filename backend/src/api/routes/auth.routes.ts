import { Router } from 'express';
import { body } from 'express-validator';
import { register, login, logout } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { handleValidationErrors } from '../middleware/validation.middleware';

const router = Router();

router.post(
    '/register',
    body('username')
        .isLength({ min: 3 }).withMessage('O nome de utilizador deve ter pelo menos 3 caracteres.')
        .trim()
        .escape(),
    body('password')
        .isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres.'),
    handleValidationErrors,
    register
);

router.post('/login', login);

router.post('/logout', authMiddleware, logout);

export default router;