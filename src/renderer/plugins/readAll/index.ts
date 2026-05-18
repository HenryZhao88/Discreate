// src/renderer/plugins/readAll/index.ts
// First-party "Read All" button — marks every unread server channel read.

export interface AckChannel {
  channelId: string;
  messageId: string;
  readStateType: number;
}

export interface ReadAllStores {
  GuildStore: { getGuilds(): Record<string, { id: string }> };
  GuildChannelStore: {
    getChannels(guildId: string): { SELECTABLE?: any[]; VOCAL?: any[] };
  };
  ActiveJoinedThreadsStore: {
    getActiveJoinedThreadsForGuild(guildId: string): Record<string, any>;
  };
  ReadStateStore: {
    hasUnread(channelId: string): boolean;
    lastMessageId(channelId: string): string;
  };
}

/**
 * Build the `channels` array for a BULK_ACK dispatch: every selectable, voice,
 * or active-thread channel across all guilds that currently has unread
 * messages. Mirrors Vencord's readAllNotificationsButton logic.
 */
export function collectUnreadChannels(stores: ReadAllStores): AckChannel[] {
  const { GuildStore, GuildChannelStore, ActiveJoinedThreadsStore, ReadStateStore } = stores;
  const out: AckChannel[] = [];

  for (const guild of Object.values(GuildStore.getGuilds())) {
    const channels = GuildChannelStore.getChannels(guild.id) ?? {};
    const threads = Object.values(
      ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id) ?? {},
    ).flatMap((t) => Object.values(t as Record<string, any>));

    for (const entry of [...(channels.SELECTABLE ?? []), ...(channels.VOCAL ?? []), ...threads]) {
      const id = entry?.channel?.id;
      if (!id || !ReadStateStore.hasUnread(id)) continue;
      out.push({ channelId: id, messageId: ReadStateStore.lastMessageId(id), readStateType: 0 });
    }
  }
  return out;
}
