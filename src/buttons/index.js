import * as lobby from './lobby.js';
import * as challenge from './challenge.js';
import * as rematch from './rematch.js';

const handlers = { lobby, challenge, rematch };

/** custom ids look like `ns:action:id` */
export function parseCustomId(customId) {
  const [ns, action, ...rest] = customId.split(':');
  return { ns, action, id: rest.join(':') };
}

export async function dispatchButton(interaction) {
  const { ns, action, id } = parseCustomId(interaction.customId);
  const h = handlers[ns];
  if (!h) return false;
  await h.handle(interaction, action, id);
  return true;
}
