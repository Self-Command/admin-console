import { websocket } from '@atproto/ws-client'
import { decodeFirehoseFrame, type FirehoseEvent } from './events.js'

export type FirehoseSourceOptions = {
  reconnectMaxSeconds: number
  maxFrameBytes: number
  maxBufferedBytes: number
}

export type FirehoseSourceRun = {
  getCursor: () => number | null
  signal: AbortSignal
  onConnect: () => void
  onDisconnect: (error: unknown) => void
  onEvent: (event: FirehoseEvent) => void | Promise<void>
  onOversizedFrame?: () => void
}

export interface FirehoseSource {
  run(options: FirehoseSourceRun): Promise<void>
}

/**
 * Live firehose subscription against the PDS. Reconnection and exponential
 * backoff are handled by the websocket client; the cursor is re-read for every
 * dial so a reconnect resumes where the persisted state left off.
 */
export function createPdsFirehoseSource(
  pdsUrl: string,
  options: FirehoseSourceOptions,
): FirehoseSource {
  return {
    async run(run) {
      const stream = websocket(
        () => {
          const url = new URL('/xrpc/com.atproto.sync.subscribeRepos', pdsUrl)
          const cursor = run.getCursor()
          if (cursor !== null) url.searchParams.set('cursor', String(cursor))
          return url
        },
        {
          dataMode: 'binary',
          maxReconnectSeconds: options.reconnectMaxSeconds,
          maxBufferedBytes: options.maxBufferedBytes,
          signal: run.signal,
          onConnect: () => run.onConnect(),
          onDisconnect: () => run.onDisconnect(new Error('firehose connection closed')),
          onReconnect: (error) => run.onDisconnect(error),
        },
      )

      for await (const message of stream) {
        if (run.signal.aborted) break
        const bytes = message
        if (bytes.byteLength > options.maxFrameBytes) {
          run.onOversizedFrame?.()
          continue
        }

        let frame
        try {
          frame = decodeFirehoseFrame(bytes)
        } catch {
          run.onOversizedFrame?.()
          continue
        }
        if (frame.kind === 'event') await run.onEvent(frame.event)
      }
    },
  }
}
