// backend/src/app.ts
import express from 'express';
import http from 'http';
import authRoutes from './api/routes/auth.routes';
import lobbyRoutes from './api/routes/lobby.routes'; // Importar as novas rotas de lobby
import { initWebSocketServer } from './websockets/websocketServer';

const app = express();

// Middlewares
app.use(express.json());

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/lobby', lobbyRoutes); // Usar as novas rotas de lobby

// Criar servidor HTTP a partir da aplicação Express
const server = http.createServer(app);

// Iniciar o servidor WebSocket e anexá-lo ao servidor HTTP
initWebSocketServer(server);

export default server;
