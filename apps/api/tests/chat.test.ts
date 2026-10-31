import { describe, expect, it } from 'vitest'
import { chatMetadataBody } from '../src/services/chat.js'

describe('chat metadata', () => {
  it('reports the reason when chat moderation is not deployed', () => {
    expect(chatMetadataBody({ chatModerationEnabled: false })).toEqual({
      enabled: false,
      reason: '当前部署未接入聊天服务，聊天审核暂不可用。',
    })
  })

  it('reports availability without reading chat content when deployed', () => {
    expect(chatMetadataBody({ chatModerationEnabled: true })).toEqual({ enabled: true })
  })
})
