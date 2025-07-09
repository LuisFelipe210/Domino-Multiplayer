import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import path from 'path';

import authRoutes from './api/routes/auth.routes';
import lobbyRoutes from './api/routes/lobby.routes';
import userRoutes from './api/routes/user.routes';
import { initWebSocketServer } from './websockets/websocketServer';

const app = express();

// Middlewares
app.use(express.json());
app.use(cookieParser());

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/lobby', lobbyRoutes);
app.use('/api/user', userRoutes);

// Rota de fallback para servir o index.html
app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
});

const server = http.createServer(app);

initWebSocketServer(server);

export default server;