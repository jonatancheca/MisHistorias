import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'

/** Servidor de protocolo SDK. No genera texto ni usa un tokenizer estimado. */
export async function startFakeLmStudio(options: { tokens?: number; capacity?: number; identifier?: string } = {}) {
  const calls: Array<{ endpoint: string; parameter: Record<string, unknown> }> = []
  const sockets = new Set<Socket>()
  const server = createServer()
  const instance = {
    type: 'llm', modelKey: 'configured-key', identifier: options.identifier ?? 'loaded-instance', instanceReference: 'instance-reference',
    path: 'publisher/model.gguf', format: 'gguf', displayName: 'Test', publisher: 'publisher', sizeBytes: 1,
    indexedModelIdentifier: 'test', deviceIdentifier: null, ttlMs: null, lastUsedTime: null,
    vision: false, trainedForToolUse: false, maxContextLength: 32768, contextLength: 8192
  }
  const results: Record<string, unknown> = {
    listLoaded: [instance], applyPromptTemplate: { formatted: '<BOS><user>Hola<assistant>' },
    countTokens: { tokenCount: options.tokens ?? 7 }, getLoadConfig: { fields: [{ key: 'llm.load.contextLength', value: options.capacity ?? 8192 }] }
  }
  server.on('upgrade', (request, socket) => {
    const connection = socket as Socket
    sockets.add(connection)
    connection.once('close', () => sockets.delete(connection))
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    connection.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const send = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value))
      const header = Buffer.alloc(payload.length < 126 ? 2 : 4)
      header[0] = 0x81
      if (payload.length < 126) header[1] = payload.length
      else { header[1] = 126; header.writeUInt16BE(payload.length, 2) }
      connection.write(Buffer.concat([header, payload]))
    }
    let buffered = Buffer.alloc(0)
    connection.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 2) {
        const opcode = buffered[0]! & 0xf
        if (opcode === 8) { connection.end(Buffer.from([0x88, 0])); return }
        let length = buffered[1]! & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffered.length < 4) return
          length = buffered.readUInt16BE(2)
          offset = 4
        }
        if (length === 127) throw new Error('Unexpected oversized SDK test frame')
        const masked = Boolean(buffered[1]! & 0x80)
        const total = offset + (masked ? 4 : 0) + length
        if (buffered.length < total) return
        const mask = masked ? buffered.subarray(offset, offset + 4) : undefined
        const payload = Buffer.from(buffered.subarray(offset + (masked ? 4 : 0), total))
        if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!
        buffered = buffered.subarray(total)
        if (opcode !== 1) continue
        const message = JSON.parse(payload.toString())
        if (message.authVersion === 1) { send({ success: true }); continue }
        if (message.type !== 'rpcCall') continue
        calls.push({ endpoint: message.endpoint, parameter: message.parameter })
        send({ type: 'rpcResult', callId: message.callId, result: results[message.endpoint] })
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, calls,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}
