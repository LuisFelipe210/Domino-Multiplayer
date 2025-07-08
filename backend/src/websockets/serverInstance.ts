import { WebSocketServer } from 'ws';

export let wss: WebSocketServer;

/**
 * Define a instância global do WSS para que possa ser acedida por outros módulos.
 * @param server A instância do WebSocketServer.
 */
export function setWss(server: WebSocketServer) {
    wss = server;
}