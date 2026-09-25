import { Room } from './room.js';
import { ctx } from '../util/context.js';
import { log } from '../util/logger.js';

/** instanceId → Room */
export const rooms = new Map();

export function getOrCreateRoom(instanceId, { guildId = null, channelId = null } = {}) {
  let room = rooms.get(instanceId);
  if (room && !room.destroyed) return room;
  room = new Room({
    instanceId,
    guildId,
    channelId,
    turnSeconds: ctx.config?.turnSeconds ?? 70,
    stats: ctx.stats,
    log,
    onEmpty: (r) => {
      if (rooms.get(instanceId) === r) rooms.delete(instanceId);
      log.info(`room ${instanceId} closed`);
    },
  });
  rooms.set(instanceId, room);
  log.info(`room ${instanceId} opened${guildId ? ` (guild ${guildId})` : ''}`);
  return room;
}

export function destroyAllRooms() {
  for (const r of [...rooms.values()]) r.destroy();
}
