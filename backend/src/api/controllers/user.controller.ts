import { Request, Response } from 'express';
import { pool } from '../../config/database';

export const getMatchHistory = async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    try {
        // MODIFICAÇÃO: Construímos o objeto de busca JSONB aqui no código
        // e o passamos como uma string para o PostgreSQL. Isso resolve o
        // problema de inferência de tipo do parâmetro.
        const playerIdentifier = JSON.stringify([{ id: userId }]);

        const historyResult = await pool.query(
            `SELECT id, room_id, winner_username, players, finished_at 
             FROM match_history 
             WHERE players @> $1::jsonb
             ORDER BY finished_at DESC
             LIMIT 20`,
            [playerIdentifier]
        );
        
        res.status(200).json(historyResult.rows);

    } catch (error) {
        console.error(`Erro ao buscar histórico de partidas para o utilizador ${userId}:`, error);
        res.status(500).json({ message: 'Erro interno ao buscar histórico de partidas.' });
    }
};