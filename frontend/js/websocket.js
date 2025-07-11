import { state } from './state.js';
import { ui } from './ui.js';

function handleMessage(message) {
    switch (message.type) {
        case 'ROOM_STATE':
            state.roomState = message;
            if (message.myId) state.myId = message.myId;
            ui.renderLobbyState();
            ui.showView('game');
            ui.hideLoading();
            break;
        case 'JOGO_INICIADO':
        case 'ESTADO_ATUALIZADO':
            state.gameEnded = false; 
            state.gameState = message;
            if (message.myId) state.myId = message.myId;
            if (message.yourHand) state.myHand = message.yourHand;
            
            ui.renderChatHistory(message.chatHistory); 

            ui.renderGameState();
            ui.showView('game');
            ui.hideLoading();
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
            state.gameEnded = true;
            state.gameState = {};
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
                ui.renderRoomsList();
            }
            break;
        case 'NEW_CHAT_MESSAGE':
            const isMe = message.username === state.username;
            ui.addChatMessage(message.username, message.message, isMe);
            if (!ui.chatWindow.classList.contains('open')) {
                ui.updateChatNotification(true);
            }
            break;
        case 'ERRO':
            ui.showAlert(`Erro: ${message.message}`);
            state.pieceToPlayWithOptions = null;
            ui.hideLoading();
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
        };

        state.ws.onmessage = (event) => {
            handleMessage(JSON.parse(event.data));
        };

        state.ws.onclose = () => {
            console.log('Desconectado do servidor de jogo.');
            clearInterval(state.turnTimerInterval);
            
            if (state.intentionalDisconnect) {
                return;
            }
            ui.showAlert('Conexão com o servidor perdida. Por favor, atualize a página.');
            ui.hideLoading();
            state.ws = null;
        };

        state.ws.onerror = (err) => {
            console.error('Erro de WebSocket:', err);
            ui.hideLoading();
            if (state.ws) {
                state.ws.close(); 
            }
        };
    },

    sendMessage(payload) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(payload));
        } else {
            console.error("WebSocket não está conectado.");
            ui.showAlert('Não foi possível enviar a mensagem. A sua conexão pode ter caído.');
        }
    },

    leaveRoom() {
        state.intentionalDisconnect = true;
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        Object.assign(state, {
            gameState: {}, roomState: {}, myHand: [], pieceToPlayWithOptions: null, gameEnded: false,
        });
        ui.renderLobbyState();
        ui.showView('lobby');
        ui.renderRoomsList();
    }
};