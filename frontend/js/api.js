import { ui } from './ui.js';
import { ws } from './websocket.js';

async function fetchAPI(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        const errorMessage = errorData.errors ? errorData.errors[0].msg : (errorData.message || 'Ocorreu um erro.');
        throw new Error(errorMessage);
    }
    return res.json();
}

export const api = {
    async register(username, password) {
        return fetchAPI('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
    },

    async login(username, password) {
        return fetchAPI('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
    },

    async logout() {
        try {
            await fetchAPI('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            console.error('Logout falhou no servidor, mas o cliente será limpo de qualquer maneira.', err);
        }
    },

    async listRooms() {
        return fetchAPI('/api/lobby/rooms');
    },

    async joinRoom(roomName, password) {
        return fetchAPI('/api/lobby/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomName, password }),
        });
    },
    
    async checkForActiveGame() {
        try {
            const res = await fetch('/api/lobby/rejoin');
            if(!res.ok) { // Sessão expirada ou outro erro
                ui.showView('auth');
                return;
            }
            const data = await res.json();
            if (data.active_game) {
                ui.showAlert('Reconectando a uma partida em andamento...');
                ws.connect(data.gameServerUrl);
            } else {
                ui.showView('lobby');
                ui.renderRoomsList();
            }
        } catch (err) {
            ui.showView('auth'); // Provavelmente cookie inválido, força novo login
        }
    }
};