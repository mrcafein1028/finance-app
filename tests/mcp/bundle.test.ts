// Kiểm tra FILE ĐÃ GÓI cho Vercel (.vercel/output/functions/api/mcp.func/index.mjs): chạy nó trong
// một tiến trình Node riêng như trên Vercel, gọi qua HTTP thật. Bắt lỗi mà test mã nguồn không thấy:
// thiếu thư viện khi gói, require() trong ESM, đọc biến môi trường, bộ chuyển Node ↔ Web.
// Chỉ chạy sau `npm run build` (không có file gói thì bỏ qua).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toReplacePayload } from '../../src/data/backup'
import { buildDemoBackup } from '../../src/data/demo'
import { FakeBackend } from '../e2e/fake-backend'

const bundle = fileURLToPath(new URL('../../.vercel/output/functions/api/mcp.func/index.mjs', import.meta.url))

describe.skipIf(!existsSync(bundle))('hàm Vercel đã gói — chạy thật trong Node', () => {
  let backend: FakeBackend
  let supabase: Server
  let fn: ChildProcess
  let mcpUrl = ''
  let token = ''

  beforeAll(async () => {
    backend = await FakeBackend.create()
    const id = await backend.createUser('lan@example.com', 'matkhau123', { onboarded: true })
    const payload = toReplacePayload(buildDemoBackup('lan', '2026-09-25'))
    await backend.asUser(id, (tx) => tx.query('select public.replace_all_data($1::jsonb)', [JSON.stringify(payload)]))
    token = backend.issueAccessToken('lan@example.com', 'claude')

    // "Supabase" chạy như một máy chủ HTTP thật.
    supabase = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
      const r = await backend.respond(req.method!, `http://127.0.0.1${req.url}`, headers, chunks.length ? Buffer.concat(chunks).toString() : null)
      res.writeHead(r.status, r.headers).end(r.body)
    })
    await new Promise<void>((resolve) => supabase.listen(0, '127.0.0.1', resolve))
    const supabaseUrl = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`

    // Hàm MCP trong tiến trình riêng, chỉ biết 2 biến môi trường như trên Vercel.
    const boot = `import(${JSON.stringify(pathToFileURL(bundle).href)}).then(async (m) => {
      const http = await import('node:http')
      const server = http.createServer(m.default).listen(0, '127.0.0.1', () => console.log('PORT=' + server.address().port))
    })`
    fn = spawn(process.execPath, ['--input-type=module', '-e', boot], {
      env: { PATH: process.env.PATH, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const port = await new Promise<string>((resolve, reject) => {
      let err = ''
      fn.stdout!.on('data', (d: Buffer) => {
        const m = /PORT=(\d+)/.exec(d.toString())
        if (m) resolve(m[1]!)
      })
      fn.stderr!.on('data', (d: Buffer) => (err += d.toString()))
      fn.on('exit', (code) => reject(new Error(`Hàm thoát (${code}): ${err}`)))
    })
    mcpUrl = `http://127.0.0.1:${port}/api/mcp`
  }, 120_000)

  afterAll(async () => {
    fn?.kill()
    await new Promise((r) => supabase?.close(r))
    await backend?.close()
  })

  it('401 + WWW-Authenticate khi thiếu token; metadata qua đường dẫn .well-known', async () => {
    const res = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/api\/mcp"/)
    const meta = await fetch(mcpUrl.replace('/api/mcp', '/api/mcp?resource_metadata=1'))
    expect(await meta.json()).toMatchObject({ resource: mcpUrl, authorization_servers: [expect.stringMatching(/\/auth\/v1$/)] })
  })

  it('Claude kết nối bằng token, đọc tổng quan và ghi một giao dịch', async () => {
    const client = new Client({ name: 'claude-smoke', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    expect((await client.listTools()).tools.length).toBe(15)
    const overview = (await client.callTool({ name: 'get_financial_overview', arguments: {} })) as { content: { text: string }[] }
    expect(JSON.parse(overview.content[0]!.text).net_worth.at_end_of_last_period).toBe(43_250_000)
    const add = (await client.callTool({
      name: 'add_transactions',
      arguments: { transactions: [{ type: 'expense', amount: 45_000, account: 'Tiền mặt', category: 'Ăn uống', note: 'Phở' }] },
    })) as { content: { text: string }[] }
    expect(JSON.parse(add.content[0]!.text).status).toBe('saved')
    await client.close()
  })
})
