import { state } from './state.js';
import { ui } from './ui.js';

function handleMessage(message) {
    console.log('WS Message received:', message.type, message); // NEW LOG
    switch (message.type) {
        case 'ROOM_STATE':
            console.log('Handling ROOM_STATE, rendering lobby state in game view.'); // NEW LOG
            state.roomState = message;
            if (message.myId) state.myId = message.myId;
            ui.renderLobbyState();
            ui.showView('game');
            ui.hideLoading(); // ESCONDER O OVERLAY APÓS RECEBER O ESTADO DA SALA
            break;
        case 'JOGO_INICIADO':
        case 'ESTADO_ATUALIZADO': // Covers both
            console.log('Handling JOGO_INICIADO/ESTADO_ATUALIZADO, rendering game state.'); // NEW LOG
            state.gameEnded = false; 
            state.gameState = message;
            if (message.myId) state.myId = message.myId;
            if (message.yourHand) state.myHand = message.yourHand;
            ui.renderGameState();
            ui.showView('game');
            ui.hideLoading(); // ESCONDER O OVERLAY APÓS ATUALIZAÇÃO DO ESTADO (incluindo reconexão)
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
            console.log('WS Error received:', message.message); // NEW LOG
            ui.showAlert(`Erro: ${message.message}`);
            state.pieceToPlayWithOptions = null; // Limpa o estado de escolha
            ui.hideLoading(); // Ensure loading is hidden on error
            break;
    }
}

export const ws = {
    connect(url) {
        if (state.ws) {
            // When connecting a new WebSocket (e.g., on page refresh),
            // we intentionally close the old one to prevent its 'onclose'
            // handler from attempting reconnects or displaying errors.
            state.intentionalDisconnect = true;
            state.ws.close();
        }
        // For the *new* WebSocket, we want unintentional disconnects (e.g. network loss)
        // to be treated as such, so we reset the flag.
        state.intentionalDisconnect = false;
        
        state.ws = new WebSocket(url);

        state.ws.onopen = () => {
            console.log('Conectado ao servidor de jogo!');
            state.reconnectAttempts = 0; // Reset attempts on successful connection
        };

        state.ws.onmessage = (event) => {
            handleMessage(JSON.parse(event.data));
        };

        state.ws.onclose = () => {
            console.log('Desconectado do servidor de jogo.');
            clearInterval(state.turnTimerInterval); // Clear any active turn timer
            
            if (state.intentionalDisconnect) {
                return;
            }

            // For unintentional disconnects (e.g., refresh, network drop),
            // do not force a redirect to login or attempt multiple reconnects here.
            // The main.js's `checkSessionAndStart` on `window.load` will
            // handle rejoining if there's an active game.
            ui.showAlert('Conexão com o servidor perdida. Por favor, atualize a página ou verifique sua conexão.');
            ui.hideLoading(); // Esconder o overlay se a conexão cair após o carregamento
            state.ws = null;
            state.reconnectAttempts = 0;
        };

        state.ws.onerror = (err) => {
            console.error('Erro de WebSocket:', err);
            ui.hideLoading(); // Esconder o overlay em caso de erro
            state.ws.close(); 
        };
    },

    sendMessage(payload) {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(payload));
        } else {
            console.error("WebSocket não está conectado.");
            // Optionally, prompt user to refresh or try again if not connected.
            ui.showAlert('Não foi possível enviar a mensagem. Por favor, reconecte-se.');
        }
    },

    leaveRoom() {
        state.intentionalDisconnect = true; // Mark as intentional
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        // Reset game-related states when leaving room intentionally
        Object.assign(state, {
            gameState: {}, roomState: {}, myHand: [], pieceToPlayWithOptions: null, gameEnded: false,
        });
        ui.renderLobbyState(); // Clear UI and show lobby
        ui.showView('lobby');
        ui.renderRoomsList(); // Refresh the list of rooms
    }
};