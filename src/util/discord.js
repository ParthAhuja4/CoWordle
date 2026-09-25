import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { log } from './logger.js';

export const NO_PINGS = { parse: [] };

export function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS, ...extra };
}

/** Reply or follow up depending on the interaction's state; never throws. */
export async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (err) {
    log.warn('safeReply failed:', err?.message ?? err);
    return null;
  }
}

export function displayName(interaction) {
  return interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
}

export function mention(userId) {
  return `<@${userId}>`;
}

export function relTime(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

export const REQUIRED_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ['CreatePublicThreads', PermissionFlagsBits.CreatePublicThreads],
  ['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads],
  ['ManageThreads', PermissionFlagsBits.ManageThreads],
];

/** Returns the list of missing permission names for the bot in `channel`. */
export function missingBotPerms(channel) {
  const me = channel.guild?.members?.me;
  if (!me) return [];
  const perms = channel.permissionsFor(me);
  if (!perms) return REQUIRED_PERMS.map(([n]) => n);
  return REQUIRED_PERMS.filter(([, bit]) => !perms.has(bit)).map(([n]) => n);
}

export function isPlayableTextChannel(channel) {
  return channel?.type === ChannelType.GuildText;
}

export async function fetchChannel(client, id) {
  try {
    return client.channels.cache.get(id) ?? (await client.channels.fetch(id));
  } catch (err) {
    log.warn(`fetchChannel(${id}) failed:`, err?.message ?? err);
    return null;
  }
}

export async function editMessage(client, channelId, messageId, payload) {
  const channel = await fetchChannel(client, channelId);
  if (!channel || !messageId) return null;
  try {
    return await channel.messages.edit(messageId, payload);
  } catch (err) {
    log.warn(`editMessage(${channelId}/${messageId}) failed:`, err?.message ?? err);
    return null;
  }
}
