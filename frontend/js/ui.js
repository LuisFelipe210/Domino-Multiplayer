import { state } from './state.js';
import { api } from './api.js';
import { ws } from './websocket.js';

// --- Elementos do DOM ---
const elements = {
    views: {
        auth: document.getElementById('auth-view'),
        lobby: document.getElementById('lobby-view'),
        game: document.getElementById('game-view'),
    },
    // Auth
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    loginSection: document.getElementById('login-section'),
    registerSection: document.getElementById('register-section'),
    showRegisterLink: document.getElementById('show-register-link'),
    showLoginLink: document.getElementById('show-login-link'),
    logoutBtn: document.getElementById('logout-btn'),
    userInfoHeader: document.getElementById('user-info-header'),
    welcomeUsername: document.getElementById('welcome-username'),
    // Lobby
    joinRoomForm: document.getElementById('join-room-form'),
    roomsList: document.getElementById('rooms-list'),
    refreshRoomsBtn: document.getElementById('refresh-rooms-btn'),
    // Game
    gameBoard: document.getElementById('game-board'),
    playerHandDiv: document.getElementById('player-hand'),
    gameStatusDiv: document.getElementById('game-status'),
    turnTimerDiv: document.getElementById('turn-timer'),
    playersInfoDiv: document.getElementById('players-info'),
    passTurnBtn: document.getElementById('pass-turn-btn'),
    leaveGameBtn: document.getElementById('leave-game-btn'),
    startGameBtn: document.getElementById('start-game-btn'),
    readyBtn: document.getElementById('ready-btn'),
    playerHandContainer: document.getElementById('player-hand-container'),
    // Modal
    alertModal: document.getElementById('alert-modal'),
    alertMessage: document.getElementById('alert-message'),
    alertModalButtons: document.getElementById('alert-modal-buttons'),
    // Histórico
    historyBtn: document.getElementById('history-btn'),
    historyModal: document.getElementById('history-modal'),
    historyListContainer: document.getElementById('history-list-container'),
    historyCloseBtn: document.getElementById('history-close-btn'),
};

function createDominoElement(piece, isHand) {
    const dominoEl = document.createElement('div');
    // Para a mão do jogador, queremos sempre que a peça seja vertical para economizar espaço
    const className = 'domino' + (isHand ? ' domino-hand' : ' domino-board');
    dominoEl.className = className;
    dominoEl.dataset.value = `${piece.value1}-${piece.value2}`;

    const createHalf = (value) => {
        const half = document.createElement('div');
        half.className = `half dots-${value}`;
        for (let i = 0; i < value; i++) {
            const dot = document.createElement('span');
            dot.className = 'dot';
            half.appendChild(dot);
        }
        return half;
    };

    const divider = document.createElement('div');
    divider.className = 'divider';

    dominoEl.appendChild(createHalf(piece.value1));
    dominoEl.appendChild(divider);
    dominoEl.appendChild(createHalf(piece.value2));

    // Se a peça está na mão, a rotacionamos para a vertical
    if (isHand) {
        dominoEl.style.transform = 'rotate(90deg)';
    }

    return dominoEl;
}

function clearBoard() {
    while (elements.gameBoard.firstChild) {
        elements.gameBoard.removeChild(elements.gameBoard.firstChild);
    }
}

export const ui = {
    ...elements, // Expõe todos os elementos para o main.js

    showView(viewName) {
        Object.values(this.views).forEach(v => v.classList.remove('active'));
        if (this.views[viewName]) {
            this.views[viewName].classList.add('active');
        }
    },

    showLoggedInHeader(username) {
        this.welcomeUsername.textContent = `Olá, ${username}`;
        this.userInfoHeader.style.display = 'flex';
    },

    showLoggedOutHeader() {
        this.userInfoHeader.style.display = 'none';
    },

    showAlert(message, buttons = [{ text: 'OK', action: 'close' }]) {
        this.alertMessage.textContent = message;
        this.alertModalButtons.innerHTML = ''; // Limpa botões anteriores

        buttons.forEach(btnInfo => {
            const button = document.createElement('button');
            button.textContent = btnInfo.text;
            button.className = 'btn';
            if (btnInfo.class) {
                button.classList.add(btnInfo.class);
            }
            
            button.onclick = () => {
                this.alertModal.style.display = 'none'; // Sempre fecha o modal ao clicar
                switch(btnInfo.action) {
                    case 'rematch':
                        ws.sendMessage({ type: 'PLAYER_READY' });
                        break;
                    case 'leave':
                        ws.leaveRoom();
                        break;
                    case 'close':
                    default:
                        // Apenas fecha, não faz mais nada
                        break;
                }
            };
            this.alertModalButtons.appendChild(button);
        });

        this.alertModal.style.display = 'flex';
    },

    async renderRoomsList() {
        try {
            const data = await api.listRooms();
            this.roomsList.innerHTML = ''; // Limpa a lista
            if (data.rooms.length === 0) {
                this.roomsList.innerHTML = '<li>Nenhuma sala disponível. Crie uma!</li>';
                return;
            }
            data.rooms.forEach(room => {
                const li = document.createElement('li');
                li.textContent = `${room.name} (${room.playerCount}/${room.maxPlayers}) ${room.hasPassword ? '🔒' : ''}`;
                this.roomsList.appendChild(li);
            });
        } catch (err) {
            this.showAlert(err.message);
            this.showView('auth'); // Provavelmente sessão expirou
        }
    },
    
    renderLobbyState() {
        const { roomState, myId } = state;

        clearBoard();
        this.playerHandContainer.style.display = 'none';
        this.passTurnBtn.style.display = 'none';
        this.turnTimerDiv.style.display = 'none';
        this.readyBtn.style.display = 'none';
        this.startGameBtn.style.display = 'none';

        if (!roomState || !roomState.players) return;
        
        this.gameStatusDiv.textContent = `A aguardar jogadores... ${roomState.playerCount} de ${roomState.maxPlayers || 4}`;
        
        const isHost = roomState.hostId === myId;
        const isReady = (roomState.readyPlayers || []).includes(myId);

        if (roomState.status === 'waiting') {
            if (state.gameEnded) { // Fluxo de Rematch
                if (isReady) {
                    this.readyBtn.style.display = 'block';
                    this.readyBtn.textContent = 'A aguardar outros...';
                    this.readyBtn.disabled = true;
                } else {
                    this.readyBtn.style.display = 'block';
                    this.readyBtn.textContent = 'Estou Pronto!';
                    this.readyBtn.disabled = false;
                }
            } else { // Lobby inicial
                if (isHost) {
                    this.startGameBtn.style.display = 'block';
                    this.startGameBtn.disabled = roomState.playerCount < 2;
                } else {
                    const host = roomState.players.find(p => p.id === roomState.hostId);
                    this.gameStatusDiv.textContent = `Aguardando o anfitrião (${host?.username || '...'}) iniciar o jogo.`;
                }
            }
        }

        this.playersInfoDiv.innerHTML = '';
        (roomState.players || []).forEach(p => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-info';
            const readyMark = (roomState.readyPlayers || []).includes(p.id) ? '✅' : '';
            const hostMark = p.id === roomState.hostId ? '⭐' : '';
            playerDiv.textContent = `${p.username || `User ${p.id}`} ${hostMark} ${readyMark}`;
            this.playersInfoDiv.appendChild(playerDiv);
        });
    },

    renderGameState() {
        const { gameState, myId, myHand, pieceToPlayWithOptions } = state;

        if (!gameState || !gameState.players) {
            this.renderLobbyState();
            return;
        }

        state.gameEnded = false;
        this.startGameBtn.style.display = 'none';
        this.readyBtn.style.display = 'none';

        // --- Status e Controles ---
        if (gameState.isSpectator) {
            this.gameStatusDiv.textContent = 'Modo Espectador';
            this.playerHandContainer.style.display = 'none';
            this.passTurnBtn.style.display = 'none';
        } else {
            const isMyTurn = gameState.turn === myId;
            const currentPlayer = gameState.players.find(p => p.id === gameState.turn);
            this.gameStatusDiv.textContent = isMyTurn ? "É a sua vez!" : `Aguardando a vez de ${currentPlayer?.username || '...'}`;
            this.playerHandContainer.style.display = 'block';
            this.passTurnBtn.style.display = 'inline-block';

            if (!isMyTurn) {
                this.passTurnBtn.disabled = true;
            } else {
                // É a minha vez, vamos verificar se tenho jogadas válidas.
                const hasPlayablePiece = (() => {
                    // Se não tiver mão, não pode jogar.
                    if (!myHand || myHand.length === 0) return false;
                    // Se o tabuleiro estiver vazio, qualquer peça é jogável.
                    if (gameState.board.length === 0) return true;
                    // Se não houver pontas ativas (jogo bloqueado), não pode jogar.
                    if (!gameState.activeEnds || gameState.activeEnds.length === 0) return false;
                    
                    // Verifica se alguma peça na mão corresponde a alguma ponta ativa.
                    return myHand.some(piece => 
                        gameState.activeEnds.some(end => 
                            piece.value1 === end.value || piece.value2 === end.value
                        )
                    );
                })();

                // Desativa o botão de passar se houver uma peça jogável.
                this.passTurnBtn.disabled = hasPlayablePiece;
            }
        }

        // --- Timer ---
        clearInterval(state.turnTimerInterval);
        if (gameState.turn === myId && !gameState.isSpectator) {
            this.turnTimerDiv.style.display = 'block';
            let timeLeft = 30;
            const updateTimerDisplay = () => {
                this.turnTimerDiv.textContent = `Tempo Restante: ${timeLeft}s`;
                this.turnTimerDiv.style.color = timeLeft <= 10 ? '#c0392b' : '#2c3e50';
            };
            updateTimerDisplay();
            state.turnTimerInterval = setInterval(() => {
                timeLeft--;
                updateTimerDisplay();
                if (timeLeft <= 0) clearInterval(state.turnTimerInterval);
            }, 1000);
        } else {
            this.turnTimerDiv.style.display = 'none';
        }

        // --- Info dos Jogadores ---
        this.playersInfoDiv.innerHTML = '';
        (gameState.players || []).forEach(p => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-info';
            if (gameState.turn === p.id) playerDiv.classList.add('current-turn');
            if (p.disconnectedSince) playerDiv.classList.add('disconnected');
            
            const pieceCount = gameState.playerPieceCounts ? gameState.playerPieceCounts[p.id] : 0;
            playerDiv.textContent = `${p.username || `User ${p.id}`}: ${pieceCount} peças ${p.disconnectedSince ? "(desconectado)" : ""}`;
            this.playersInfoDiv.appendChild(playerDiv);
        });
        
        // --- Mão do Jogador ---
        this.playerHandDiv.innerHTML = '';
        (myHand || []).forEach(piece => {
            const dominoEl = createDominoElement(piece, true);
            dominoEl.onclick = () => {
                if (gameState.isSpectator || gameState.turn !== myId || pieceToPlayWithOptions) return;
                ws.sendMessage({ type: 'PLAY_PIECE', piece });
            };
            this.playerHandDiv.appendChild(dominoEl);
        });
        
        // --- Tabuleiro ---
        clearBoard();
        const boardRect = this.gameBoard.getBoundingClientRect();
        const centerX = boardRect.width / 2;
        const centerY = boardRect.height / 2;
        // MODIFICADO: A unidade de coordenada do backend é 1/2 peça, que agora tem 36px.
        const spacing = 36;
        
        (gameState.board || []).forEach(placedDomino => {
            const dominoEl = createDominoElement(placedDomino.piece, false);
            
            const xPos = centerX + placedDomino.x * spacing;
            const yPos = centerY + placedDomino.y * spacing;
            
            dominoEl.style.left = `${xPos}px`;
            dominoEl.style.top = `${yPos}px`;
            dominoEl.style.transform = `translate(-50%, -50%) rotate(${placedDomino.rotation}deg)`;
            dominoEl.style.transformOrigin = 'center center';
            
            this.gameBoard.appendChild(dominoEl);
        });

        // --- Destaque de Pontas Jogáveis ---
        if(pieceToPlayWithOptions) {
             (gameState.activeEnds || []).forEach(end => {
                if (pieceToPlayWithOptions.options.some(opt => opt.endId === end.id)) {
                    const endEl = document.createElement('div');
                    endEl.className = 'playable-end-highlight';
                    const xPos = centerX + end.x * spacing;
                    const yPos = centerY + end.y * spacing;
                    endEl.style.left = `${xPos}px`;
                    endEl.style.top = `${yPos}px`;
                    endEl.onclick = () => {
                        ws.sendMessage({ type: 'PLAY_PIECE', piece: pieceToPlayWithOptions.piece, endId: end.id });
                        state.pieceToPlayWithOptions = null;
                        clearBoard();
                        this.renderGameState();
                    };
                    this.gameBoard.appendChild(endEl);
                }
             });
        }
    },

    renderMatchHistory(history) {
        this.historyListContainer.innerHTML = ''; // Limpa conteúdo anterior

        if (!history || history.length === 0) {
            this.historyListContainer.innerHTML = '<p style="text-align: center; padding: 20px;">Nenhuma partida encontrada no seu histórico.</p>';
        } else {
            history.forEach(match => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'history-item';

                const isWinner = match.winner_username === state.username;
                const wasInMatch = match.players.some(p => p.id === state.myId);
                let resultText = 'Finalizada';
                let resultClass = '';

                if (wasInMatch && match.winner_username) {
                    resultText = isWinner ? 'Vitória' : 'Derrota';
                    resultClass = isWinner ? 'victory' : 'defeat';
                }

                const players = match.players.map(p => p.username).join(', ');
                const date = new Date(match.finished_at).toLocaleString('pt-BR');

                itemDiv.innerHTML = `
                    <div class="history-item-info">
                        <p><strong>Vencedor:</strong> ${match.winner_username || 'Ninguém (Empate)'}</p>
                        <p class="players-list"><strong>Jogadores:</strong> ${players}</p>
                        <p><strong>Data:</strong> ${date}</p>
                    </div>
                    <div class="history-item-result ${resultClass}">
                        ${resultText}
                    </div>
                `;
                this.historyListContainer.appendChild(itemDiv);
            });
        }

        this.historyModal.style.display = 'flex';
    },
};