export const state = {
    ws: null,
    myId: null,
    roomState: {},
    myHand: [],
    gameState: {},
    pieceToPlayWithOptions: null,
    intentionalDisconnect: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    turnTimerInterval: null,
    gameEnded: false,
};