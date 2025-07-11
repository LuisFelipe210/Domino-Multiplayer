import { ui } from './ui.js';
import { ws } from './websocket.js';

async function fetchAPI(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const finalOptions = { ...defaultOptions, ...options };
    if (finalOptions.body) {
        finalOptions.body = JSON.stringify(finalOptions.body);
    }

    try {
        const res = await fetch(url, finalOptions);
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ message: res.statusText }));
            const errorMessage = (errorData.errors ? errorData.errors[0].msg : errorData.message) || 'Ocorreu um erro desconhecido.';
            throw new Error(errorMessage);
        }
        // Se a resposta for 204 No Content, retorna um objeto vazio
        if (res.status === 204) {
            return {};
        }
        return res.json();
    } catch (error) {
        // Re-lança o erro para que a função que chamou possa tratá-lo
        throw error;
    }
}


export const api = {
    async register(username, password) {
        return fetchAPI('/api/auth/register', {
            method: 'POST',
            body: { username, password },
        });
    },

    async login(username, password) {
        return fetchAPI('/api/auth/login', {
            method: 'POST',
            body: { username, password },
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
            body: { roomName, password },
        });
    },
    
    async checkForActiveGame() {
        // Este é o endpoint chave para a reconexão automática
        return fetchAPI('/api/lobby/rejoin');
    },

    async getMatchHistory() {
        return fetchAPI('/api/user/history');
    }
};