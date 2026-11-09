import type { Config } from '../config.js'

export type ChatMetadataBody = {
  enabled: boolean
  reason?: string
}

export function chatMetadataBody(
  config: Pick<Config, 'chatModerationEnabled'>,
): ChatMetadataBody {
  if (config.chatModerationEnabled) return { enabled: true }
  return {
    enabled: false,
    reason: '当前部署未接入聊天服务，聊天审核暂不可用。',
  }
}
