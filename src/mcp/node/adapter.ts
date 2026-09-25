import type { IncomingMessage, ServerResponse } from 'node:http'

// Chuyển hàm kiểu Web (Request → Response) thành handler Node (req, res) — dạng mà mọi runtime
// Node của Vercel đều chạy được. Dùng cả cho máy chủ thử trên máy (scripts/mcp-local.mjs).

const MAX_BODY = 2 * 1024 * 1024 // 2 MB: đủ cho 50 giao dịch; chặn request quá lớn.

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > MAX_BODY) throw Object.assign(new Error('Payload too large'), { status: 413 })
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

export function toNodeHandler(handler: (request: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Sau proxy của Vercel: x-forwarded-proto = https. Chạy trực tiếp: theo kết nối thật.
      const direct = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
      const proto = String(req.headers['x-forwarded-proto'] ?? direct).split(',')[0]!.trim()
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0]!.trim()
      const url = new URL(req.url ?? '/', `${proto}://${host}`)
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v)
      }
      const method = req.method ?? 'GET'
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
      const response = await handler(new Request(url, { method, headers, body: body && body.length ? new Uint8Array(body) : undefined }))
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500
      if (status === 500) console.error('[mcp] lỗi cổng HTTP', e)
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: status === 413 ? 'payload_too_large' : 'server_error' }))
    }
  }
}
