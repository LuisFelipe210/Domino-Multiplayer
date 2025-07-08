import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/database';
import { JWT_SECRET } from '../../config/environment'

export const register = async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const newUser = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, passwordHash]
        );
        res.status(201).json(newUser.rows[0]);
    } catch (error: any) {
        console.error("Erro no registo:", error);
        if (error.code === '23505') {
             return res.status(409).json({ message: 'Este nome de utilizador já existe.' });
        }
        res.status(500).json({ message: 'Erro interno ao registar utilizador.' });
    }
};

export const login = async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
    }

    try {
        const userResult = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const user = userResult.rows[0];
        const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordCorrect) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        const token = jwt.sign({ userId: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict', 
            maxAge: 3600000
        });

        res.status(200).json({ 
            success: true, 
            user: {
                id: user.id,
                username: user.username
            }
        });

    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
};

export const logout = async (req: Request, res: Response) => {
    res.clearCookie('token');
    res.status(200).json({ message: 'Logout bem-sucedido.' });
};