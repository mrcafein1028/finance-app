import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createClient } from '@supabase/supabase-js'
import { createRepositories } from '../data/repositories'
import { createFinanceMcpServer } from './server'

// Cổng HTTP của máy chủ MCP (Streamable HTTP, không trạng thái — hợp với hàm serverless của Vercel).
//
// Xác thực theo đặc tả MCP authorization: Supabase Auth là máy chủ cấp quyền OAuth 2.1 (bật trong
// dashboard). Request thiếu/sai token → 401 + WWW-Authenticate trỏ tới "protected resource metadata"
// để Claude tự tìm Supabase, tự đăng ký (DCR) và đưa người dùng tới trang đồng ý /oauth/consent.
// Token Supabase cấp là JWT của chính người dùng (role authenticated) → mọi truy vấn đi qua RLS:
// máy chủ không cần và KHÔNG dùng service_role key.

export const MCP_PATH = '/api/mcp'
export const METADATA_PATH = '/.well-known/oauth-protected-resource'

export interface McpHttpOptions {
  supabaseUrl: string
  /** Publishable / anon key — giống key của web app. */
  supabaseKey: string
  timeZone?: string
  now?: () => Date
  /** Test truyền fetch của backend giả. */
  fetch?: typeof fetch
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...headers } })

/** Địa chỉ công khai của máy chủ, đúng như người dùng dán vào Claude (https://<app>.vercel.app/api/mcp). */
export const resourceUrl = (origin: string) => `${origin}${MCP_PATH}`

export function protectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [`${supabaseUrl.replace(/\/$/, '')}/auth/v1`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['email'],
    resource_name: 'Tài Chính Cá Nhân',
    resource_documentation: `${origin}/settings`,
  }
}

function unauthorized(origin: string, error?: string) {
  const params = [`resource_metadata="${origin}${METADATA_PATH}${MCP_PATH}"`, 'scope="email"', ...(error ? [`error="${error}"`] : [])]
  return json(
    401,
    { error: error ?? 'unauthorized', error_description: 'Cần đăng nhập Tài Chính Cá Nhân và cấp quyền cho ứng dụng này.' },
    { 'www-authenticate': `Bearer ${params.join(', ')}` },
  )
}

export function createMcpHttpHandler(options: McpHttpOptions): (request: Request) => Promise<Response> {
  const authClient = createClient(options.supabaseUrl, options.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: options.fetch ? { fetch: options.fetch } : {},
  })

  return async (request) => {
    const url = new URL(request.url)
    const origin = url.origin
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    // Vercel chuyển /.well-known/oauth-protected-resource/* về hàm này kèm ?resource_metadata=1.
    if (url.pathname.startsWith(METADATA_PATH) || (request.method === 'GET' && url.searchParams.has('resource_metadata'))) {
      return json(200, protectedResourceMetadata(origin, options.supabaseUrl), { 'cache-control': 'public, max-age=300' })
    }
    if (url.pathname !== MCP_PATH) return json(404, { error: 'not_found' })

    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim()
    if (!token) return unauthorized(origin)
    // Hỏi Supabase: token còn hạn, chưa bị thu hồi? (Hoạt động với cả khóa ký JWT đối xứng lẫn bất đối xứng.)
    const { data, error } = await authClient.auth.getUser(token)
    if (error || !data.user) return unauthorized(origin, 'invalid_token')

    const client = createClient(options.supabaseUrl, options.supabaseKey, {
      accessToken: async () => token,
      global: options.fetch ? { fetch: options.fetch } : {},
    })
    const repos = createRepositories(client, { userId: data.user.id })
    const server = createFinanceMcpServer({ repos, now: options.now, timeZone: options.timeZone })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      const response = await transport.handleRequest(request, { authInfo: { token, clientId: clientIdOf(token), scopes: [], extra: { userId: data.user.id } } })
      const headers = new Headers(response.headers)
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
      return new Response(response.body, { status: response.status, headers })
    } finally {
      await server.close()
    }
  }
}

/** client_id trong JWT do Supabase OAuth server cấp (để ghi log; không dùng cho phân quyền). */
function clientIdOf(token: string): string {
  try {
    const part = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part)) as { client_id?: string }
    return payload.client_id ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
