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
        return fetchAPI('/api/lobby/rejoin');
    }
};