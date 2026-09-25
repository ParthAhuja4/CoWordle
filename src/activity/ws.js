/**
 * WebSocket transport between the Activity page and its Room.
 *
 * Browser → server: { t:'settings', mode?, turnsEach?, turnSeconds? } · { t:'start' } ·
 *                   { t:'guess', word } · { t:'forfeit' } · { t:'next' } (host starts next round) · { t:'ping' }
 * Server → browser: { t:'state', … } (full snapshot) · { t:'guess', ok, … } ·
 *                   { t:'event', kind, text } · { t:'error', text } · { t:'pong' }
 */
import { WebSocketServer } from 'ws';
import { verifySession, sessionSecret } from './auth.js';
import { getOrCreateRoom } from './rooms.js';
import { stripProxy } from '../http.js';
import { log } from '../util/logger.js';

const HEARTBEAT_MS = 30_000;

export function attachWebSocket(server, config) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (stripProxy(url.pathname) !== '/ws') {
      socket.destroy();
      return;
    }
    const session = verifySession(url.searchParams.get('s'), sessionSecret(config));
    const instanceId = url.searchParams.get('i');
    if (!session || !instanceId || !/^[\w-]{1,80}$/.test(instanceId)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const channelId = url.searchParams.get('c');
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, { session, instanceId, channelId: channelId && /^\d+$/.test(channelId) ? channelId : null });
    });
  });

  wss.on('connection', (ws, { session, instanceId, channelId }) => {
    const room = getOrCreateRoom(instanceId, { guildId: session.guildId, channelId });
    const userId = session.user.id;
    room.join(session.user, ws);
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        switch (msg.t) {
          case 'ping':
            room.send(ws, { t: 'pong', now: Date.now() });
            break;
          case 'settings':
            room.setSettings(userId, { mode: msg.mode, turnsEach: msg.turnsEach, turnSeconds: msg.turnSeconds });
            break;
          case 'start':
            room.start(userId);
            break;
          case 'guess': {
            const res = room.guess(userId, msg.word);
            room.send(ws, { t: 'guess', ...res });
            break;
          }
          case 'forfeit':
            room.forfeit(userId);
            break;
          case 'next':
            room.next(userId);
            break;
          default:
            room.send(ws, { t: 'error', text: 'Unknown message.' });
        }
      } catch (err) {
        log.error(`ws message ${msg.t} failed:`, err);
        room.send(ws, { t: 'error', text: 'Something went wrong.' });
      }
    });

    ws.on('close', () => room.leaveSocket(ws));
    ws.on('error', (err) => log.warn('ws error:', err?.message ?? err));
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  interval.unref();
  wss.on('close', () => clearInterval(interval));
  return wss;
}
