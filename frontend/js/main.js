import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { ws } from './websocket.js';

async function checkSessionAndStart() {
    try {
        const data = await api.checkForActiveGame();

        if (data.user && data.user.username) {
            state.myId = data.user.userId;
            state.username = data.user.username;
            ui.showLoggedInHeader(state.username);
        }

        if (data.active_game) {
            ui.showLoading();
            ui.showView('game');
            ws.connect(data.gameServerUrl);
        } else {
            ui.showView('lobby');
            ui.renderRoomsList();
        }
    } catch (error) {
        ui.hideLoading(); 
        state.myId = null;
        state.username = null;
        ui.showLoggedOutHeader();
        ui.showView('auth');
    }
}

ui.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        await api.login(username, password);
        await checkSessionAndStart();
    } catch (err) {
        ui.showAlert(`Erro no login: ${err.message}`);
    }
});

ui.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    try {
        await api.register(username, password);
        ui.showAlert('Registo bem-sucedido! Por favor, faça o login.');
        ui.registerForm.reset();
        ui.registerSection.style.display = 'none';
        ui.loginSection.style.display = 'block';
    } catch (err) {
        ui.showAlert(`Erro no registo: ${err.message}`);
    }
});

ui.logoutBtn.addEventListener('click', async () => {
    state.intentionalDisconnect = true;
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    await api.logout();
    state.myId = null;
    state.username = null;
    ui.showLoggedOutHeader();
    ui.showView('auth');
});

ui.showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    ui.loginSection.style.display = 'none';
    ui.registerSection.style.display = 'block';
});

ui.showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    ui.registerSection.style.display = 'none';
    ui.loginSection.style.display = 'block';
});

ui.refreshRoomsBtn.addEventListener('click', () => ui.renderRoomsList());

ui.joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomName = document.getElementById('room-name').value;
    const password = document.getElementById('room-password').value;
    try {
        const data = await api.joinRoom(roomName, password);
        ui.showLoading();
        ws.connect(data.gameServerUrl);
    } catch (err) {
        ui.showAlert(`Erro ao entrar na sala: ${err.message}`);
    }
});

ui.startGameBtn.addEventListener('click', () => {
    if (state.roomState.hostId === state.myId) {
        ws.sendMessage({ type: 'START_GAME' });
    }
});

ui.readyBtn.addEventListener('click', () => {
    ws.sendMessage({ type: 'PLAYER_READY' });
});

ui.passTurnBtn.addEventListener('click', () => {
    if (state.gameState.turn === state.myId) {
        ws.sendMessage({ type: 'PASS_TURN' });
    } else {
        ui.showAlert('Não é a sua vez de passar.');
    }
});

ui.leaveGameBtn.addEventListener('click', () => {
    const isPlaying = state.gameState && state.gameState.board && state.gameState.board.length > 0;
    const confirmationMessage = isPlaying
        ? 'Tem a certeza que quer abandonar a partida? Isto contará como uma derrota.'
        : 'Tem a certeza que quer sair da sala?';
    
    ui.showAlert(confirmationMessage, [
        { text: 'Sim, sair', action: 'leave', class: 'btn-danger' },
        { text: 'Cancelar', action: 'close' }
    ]);
});

ui.historyBtn.addEventListener('click', async () => {
    try {
        const history = await api.getMatchHistory();
        ui.renderMatchHistory(history);
    } catch (err) {
        ui.showAlert(`Erro ao buscar histórico: ${err.message}`);
    }
});
ui.historyCloseBtn.addEventListener('click', () => {
    ui.historyModal.style.display = 'none';
});

ui.chatToggleBtn.addEventListener('click', () => {
    ui.toggleChatWindow();
    if (ui.chatWindow.classList.contains('open')) {
        ui.updateChatNotification(false);
    }
});
ui.chatCloseBtn.addEventListener('click', () => {
    ui.toggleChatWindow();
});
ui.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = ui.chatInput.value.trim();
    if (message) {
        ws.sendMessage({ type: 'CHAT_MESSAGE', message: message });
        ui.chatInput.value = '';
    }
});

window.addEventListener('load', () => {
  checkSessionAndStart(); 
});