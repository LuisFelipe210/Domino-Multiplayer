import { state } from './state.js';
import { ui } from './ui.js';

function handleMessage(message) {
    console.log('Mensagem recebida:', message);
    switch (message.type) {
        case 'ROOM_STATE':
            state.roomState = message;
            if (message.myId) state.myId = message.myId;
            ui.renderLobbyState();
            ui.showView('game');
            break;
        case 'JOGO_INICIADO':
            state.gameEnded = false; // Reseta a flag
            state.gameState = message;
            if (message.myId) state.myId = message.myId;
            if (message.yourHand) state.myHand = message.yourHand;
            ui.renderGameState();
            ui.showView('game');
            break;
        case 'ESTADO_ATUALIZADO':
            state.gameState = message;
            if (message.myId) state.myId = message.myId;
            if (message.yourHand) state.myHand = message.yourHand;
            ui.renderGameState();
            ui.showView('game');
            break;
        case 'UPDATE_HAND':
            state.myHand = message.yourNewHand;
            ui.renderGameState();
            break;
        case 'CHOOSE_PLACEMENT':
            state.pieceToPlayWithOptions = message;
            ui.showAlert(`A sua peça ${message.piece.value1}-${message.piece.value2} pode ser jogada em mais de um lugar. Clique numa ponta válida no tabuleiro.`);
            ui.renderGameState();
            break;
        case 'JOGO_TERMINADO':
            state.gameEnded = true; // Define a flag
            state.gameState = {};   // Limpa o estado do jogo anterior
            const gameOverMessage = `Fim de jogo! Vencedor: ${message.winner}. Motivo: ${message.reason}`;
            if (message.canRematch) {
                ui.showAlert(gameOverMessage, [
                    { text: 'Jogar Novamente', action: 'rematch', class: 'btn-secondary' },
                    { text: 'Sair para o Lobby', action: 'leave', class: 'btn-danger' }
                ]);
            } else {
                 ui.showAlert(gameOverMessage, [
                    { text: 'OK', action: 'leave' }
                 ]);
            }
            break;
        case 'ROOM_REMOVED':
             if (ui.views.lobby.classList.contains('active')) {
                ui.renderRoomsList(); // Mais simples que remover um por um
            }
            break;
        case 'ERRO':
            ui.showAlert(`Erro: ${message.message}`);
            state.pieceToPlayWithOptions = null; // Limpa o estado de escolha
            break;
    }
}

export const ws = {
    connect(url) {
        if (state.ws) {
            state.intentionalDisconnect = true;
            state.ws.close();
        }
        state.intentionalDisconnect = false;
        
        state.ws = new WebSocket(url);

        state.ws.onopen = () => {
            console.log('Conectado ao servidor de jogo!');
            state.reconnectAttempts = 0;
        };

        state.ws.onmessage = (event) => {
            handleMessage(JSON.parse(event.data));
        };

        state.ws.onclose = () => {
            console.log('Desconectado do servidor de jogo.');
            clearInterval(state.turnTimerInterval);
            if (state.intentionalDisconnect) return;

            if (state.reconnectAttempts < state.maxReconnectAttempts) {
                state.reconnectAttempts++;
                const delay = Math.pow(2, state.reconnectAttempts) * 1000;
                console.log(`Tentando reconectar em ${delay / 1000}s... (tentativa ${state.reconnectAttempts})`);
                setTimeout(() => this.connect(url), delay);
            } else {
                ui.showAlert('A conexão com o servidor foi perdida. Por favor, faça o login novamente.');
                ui.showView('auth');
            }
        };

        state.ws.onerror = (err) => {
            console.error('Erro de WebSocket:', err);
            state.ws.close();
        };
    },

    sendMessage(payload) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(payload));
        } else {
            console.error("WebSocket não está conectado.");
        }
    },

    leaveRoom() {
        state.intentionalDisconnect = true;
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        // Resetar estados
        Object.assign(state, {
            gameState: {}, roomState: {}, myHand: [], pieceToPlayWithOptions: null, gameEnded: false,
        });
        ui.renderLobbyState(); // Limpa a UI
        ui.showView('lobby');
        ui.renderRoomsList();
    }
};