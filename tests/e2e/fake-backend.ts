// Backend giả: đóng vai Supabase (Auth + PostgREST + Storage + OAuth 2.1 server) nhưng dữ liệu nằm
// trong Postgres THẬT (PGlite) đã chạy đủ migration — RLS, CHECK, trigger, RPC đều có hiệu lực.
// Dùng ở 2 nơi: E2E (chặn request của trình duyệt qua page.route) và test máy chủ MCP (qua `fetch`).
// Ứng dụng không biết mình đang nói chuyện với backend giả: nó gọi supabase-js như thường.
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from '@playwright/test'
import { createMigratedDb, insertAuthUser } from '../support/pg'

export const SUPABASE_URL = 'http://127.0.0.1:54321'

type Json = Record<string, unknown>
type Tx = Parameters<Parameters<PGlite['transaction']>[0]>[0]

interface AuthUser {
  id: string
  email: string
  password: string
  confirmed: boolean
}

export interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: string
}

interface OAuthClient {
  id: string
  name: string
  uri: string
  logo_uri: string
}

/** Một yêu cầu cấp quyền OAuth đang chờ người dùng đồng ý (Supabase tạo khi client gọi /oauth/authorize). */
interface OAuthRequest {
  client: OAuthClient
  redirectUri: string
  scope: string
  state: string
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name: string): string {
  if (!IDENT.test(name)) throw new HttpError(400, { code: 'PGRST100', message: `Tên cột/bảng không hợp lệ: ${name}` })
  return `"${name}"`
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
  ) {
    super(String(body.message))
  }
}

export class FakeBackend {
  private users = new Map<string, AuthUser>()
  private refreshTokens = new Map<string, string>()
  /** Mọi request app đã gửi — để test kiểm tra app gửi đúng dữ liệu. */
  readonly calls: { method: string; path: string; body: unknown }[] = []
  /** File trong Supabase Storage giả: "<bucket>/<đường dẫn>" → nội dung. */
  readonly files = new Map<string, string>()
  /** Giả lập Storage lỗi (VD chưa chạy migration storage) để kiểm tra đường dự phòng. */
  storageDown = false
  /** OAuth 2.1 server: yêu cầu đang chờ đồng ý, và quyền đã cấp theo người dùng → client. */
  private oauthRequests = new Map<string, OAuthRequest>()
  readonly oauthGrants = new Map<string, Map<string, { client: OAuthClient; scopes: string[]; granted_at: string }>>()

  private constructor(
    readonly db: PGlite,
    private readonly options: { autoConfirm: boolean },
  ) {}

  static async create(options: { autoConfirm?: boolean } = {}) {
    return new FakeBackend(await createMigratedDb(), { autoConfirm: options.autoConfirm ?? true })
  }

  async close() {
    await this.db.close()
  }

  // ---------------------------------------------------------------- dữ liệu mẫu

  async createUser(email: string, password: string, { onboarded = false } = {}): Promise<string> {
    const id = await insertAuthUser(this.db, email)
    this.users.set(email, { id, email, password, confirmed: true })
    if (onboarded) await this.db.query('update public.settings set onboarding_completed = true where user_id = $1', [id])
    return id
  }

  /** Chạy một hàm SQL như chính người dùng đó (qua RLS). */
  async asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
      return fn(tx)
    })
  }

  async rows(userId: string, sql: string, params: unknown[] = []): Promise<Json[]> {
    return this.asUser(userId, async (tx) => (await tx.query<{ r: Json }>(`select to_jsonb(t) as r from (${sql}) t`, params)).rows.map((x) => x.r))
  }

  /** Token truy cập như Supabase OAuth server cấp cho một client (VD Claude) sau khi người dùng đồng ý. */
  issueAccessToken(email: string, clientId?: string): string {
    const u = this.users.get(email)
    if (!u) throw new Error(`Chưa có người dùng ${email}`)
    return this.session(u, clientId).access_token
  }

  /** Mô phỏng Claude gọi /oauth/authorize: Supabase tạo yêu cầu và chuyển người dùng tới trang đồng ý của app. */
  createAuthorizationRequest(client: { name: string; uri?: string }, redirectUri: string, scope = 'email'): { authorizationId: string; clientId: string } {
    const authorizationId = crypto.randomUUID()
    const oauthClient: OAuthClient = { id: `client-${authorizationId.slice(0, 8)}`, name: client.name, uri: client.uri ?? '', logo_uri: '' }
    this.oauthRequests.set(authorizationId, { client: oauthClient, redirectUri, scope, state: `state-${authorizationId.slice(0, 8)}` })
    return { authorizationId, clientId: oauthClient.id }
  }

  // ---------------------------------------------------------------- cổng vào

  async install(page: Page) {
    await page.route(`${SUPABASE_URL}/**`, async (route) => {
      const request = route.request()
      const res = await this.respond(request.method(), request.url(), await request.allHeaders(), request.postData())
      await route.fulfill({ status: res.status, headers: res.headers, body: res.body })
    })
  }

  /** `fetch` trỏ vào backend giả — truyền cho supabase-js (`global.fetch`) khi chạy ngoài trình duyệt. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const headers = Object.fromEntries([...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]))
    const text = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text()
    const res = await this.respond(request.method, request.url, headers, text || null)
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers })
  }

  /** Xử lý một request HTTP tới "Supabase" — không phụ thuộc Playwright. */
  async respond(method: string, rawUrl: string, headers: Record<string, string>, rawBody: string | null): Promise<FakeResponse> {
    const url = new URL(rawUrl)
    let body: unknown = null
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = null // body không phải JSON (VD file tải lên Storage)
      }
    }
    this.calls.push({ method, path: url.pathname + url.search, body })
    try {
      if (url.pathname.startsWith('/auth/v1/')) return await this.auth(url, method, body, headers)
      if (url.pathname.startsWith('/rest/v1/')) return await this.rest(url, method, body, headers)
      if (url.pathname.startsWith('/storage/v1/object/') && method === 'POST') return this.storageUpload(url, rawBody ?? '', headers)
      throw new HttpError(404, { message: `Không giả lập ${url.pathname}` })
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, e.body)
      const pg = e as { code?: string; message: string }
      return json(statusOf(pg), { code: pg.code ?? 'XX000', message: pg.message, details: null, hint: null })
    }
  }

  // ---------------------------------------------------------------- Storage

  /** Chính sách giống migration storage: chỉ ghi được vào thư mục <user_id>/ của mình, không ghi đè. */
  private storageUpload(url: URL, content: string, headers: Record<string, string>): FakeResponse {
    if (this.storageDown) throw new HttpError(500, { statusCode: '500', error: 'internal', message: 'Storage không khả dụng' })
    const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''))
    const [bucket, folder] = key.split('/')
    const uid = subject(headers)
    if (bucket !== 'user-files' || !uid || folder !== uid) throw new HttpError(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
    if (this.files.has(key)) throw new HttpError(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    this.files.set(key, content)
    return json(200, { Key: key, Id: crypto.randomUUID() })
  }

  // ---------------------------------------------------------------- Auth (GoTrue)

  private userJson(u: AuthUser, identities = true) {
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: u.confirmed ? '2026-08-01T00:00:00Z' : null,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: identities ? [{ id: `i-${u.id}`, provider: 'email' }] : [],
      created_at: '2026-08-01T00:00:00Z',
    }
  }

  private session(u: AuthUser, clientId?: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const claims = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: expiresAt, ...(clientId ? { client_id: clientId } : {}) }
    const accessToken = [b64({ alg: 'HS256', typ: 'JWT' }), b64(claims), 'sig'].join('.')
    const refresh = `refresh-${crypto.randomUUID()}`
    this.refreshTokens.set(refresh, u.email)
    return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: refresh, user: this.userJson(u) }
  }

  private userFromHeaders(headers: Record<string, string>): AuthUser | null {
    const sub = subject(headers)
    return [...this.users.values()].find((u) => u.id === sub) ?? null
  }

  private async auth(url: URL, method: string, body: unknown, headers: Record<string, string>): Promise<FakeResponse> {
    const path = url.pathname.replace('/auth/v1', '')
    const b = (body ?? {}) as { email?: string; password?: string; refresh_token?: string }

    if (path === '/signup' && method === 'POST') {
      const existing = this.users.get(b.email!)
      if (existing) {
        // Supabase khi bật xác nhận email: không báo lỗi, trả user không có identity.
        if (!this.options.autoConfirm) return json(200, this.userJson(existing, false))
        throw new HttpError(422, { code: 'user_already_exists', error_code: 'user_already_exists', msg: 'User already registered' })
      }
      const id = await insertAuthUser(this.db, b.email!)
      const user: AuthUser = { id, email: b.email!, password: b.password!, confirmed: this.options.autoConfirm }
      this.users.set(user.email, user)
      return json(200, this.options.autoConfirm ? this.session(user) : this.userJson(user))
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
      const u = this.users.get(b.email!)
      if (!u || u.password !== b.password) throw new HttpError(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      if (!u.confirmed) throw new HttpError(400, { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
      return json(200, this.session(u))
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const email = this.refreshTokens.get(b.refresh_token!)
      const u = email ? this.users.get(email) : undefined
      if (!u) throw new HttpError(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
      return json(200, this.session(u))
    }
    if (path === '/user') {
      const u = this.userFromHeaders(headers)
      if (!u) throw new HttpError(401, { code: 'no_authorization', msg: 'Unauthorized' })
      if (method === 'PUT' && b.password) u.password = b.password
      return json(200, this.userJson(u))
    }
    if (path === '/logout') return empty(204)
    if (path === '/recover') return json(200, {})

    // OAuth 2.1 server (trang đồng ý của app + quản lý quyền đã cấp) — giống API mà supabase-js gọi.
    const authz = /^\/oauth\/authorizations\/([^/]+)(\/consent)?$/.exec(path)
    if (authz) {
      const u = this.userFromHeaders(headers)
      if (!u) throw new HttpError(401, { code: 'no_authorization', msg: 'Unauthorized' })
      const request = this.oauthRequests.get(authz[1]!)
      if (!request) throw new HttpError(404, { code: 'oauth_authorization_not_found', msg: 'Authorization not found or expired' })
      const redirect = (params: Record<string, string>) => `${request.redirectUri}?${new URLSearchParams({ ...params, state: request.state })}`
      if (!authz[2] && method === 'GET') {
        if (this.oauthGrants.get(u.id)?.has(request.client.id)) return json(200, { redirect_url: redirect({ code: `code-${authz[1]}` }) })
        return json(200, { authorization_id: authz[1], redirect_uri: request.redirectUri, client: request.client, user: { id: u.id, email: u.email }, scope: request.scope })
      }
      if (authz[2] && method === 'POST') {
        this.oauthRequests.delete(authz[1]!)
        if ((body as { action?: string } | null)?.action !== 'approve') return json(200, { redirect_url: redirect({ error: 'access_denied' }) })
        const grants = this.oauthGrants.get(u.id) ?? new Map()
        grants.set(request.client.id, { client: request.client, scopes: request.scope.split(' '), granted_at: '2026-09-25T03:00:00Z' })
        this.oauthGrants.set(u.id, grants)
        return json(200, { redirect_url: redirect({ code: `code-${authz[1]}` }) })
      }
    }
    if (path === '/user/oauth/grants') {
      const u = this.userFromHeaders(headers)
      if (!u) throw new HttpError(401, { code: 'no_authorization', msg: 'Unauthorized' })
      const grants = this.oauthGrants.get(u.id) ?? new Map()
      if (method === 'GET') return json(200, [...grants.values()])
      if (method === 'DELETE') {
        grants.delete(url.searchParams.get('client_id') ?? '')
        return empty(204)
      }
    }
    throw new HttpError(404, { message: `Auth giả chưa hỗ trợ ${method} ${path}` })
  }

  // ---------------------------------------------------------------- PostgREST

  private async rest(url: URL, method: string, body: unknown, headers: Record<string, string>): Promise<FakeResponse> {
    const uid = subject(headers)
    const path = url.pathname.replace('/rest/v1/', '')
    const prefer = headers['prefer'] ?? ''
    const wantsObject = (headers['accept'] ?? '').includes('application/vnd.pgrst.object')
    const representation = prefer.includes('return=representation')

    const result = await this.db.transaction(async (tx) => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`)
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
      if (path.startsWith('rpc/')) return this.rpc(tx, path.slice(4), (body ?? {}) as Json)
      const table = `public.${ident(path)}`
      const where = buildWhere(url.searchParams)
      const read = async (sql: string, params: unknown[]) => (await tx.query<{ row_json: Json }>(sql, params)).rows.map((r) => r.row_json)

      switch (method) {
        case 'GET': {
          const order = buildOrder(url.searchParams.get('order'))
          const limit = url.searchParams.get('limit')
          const offset = url.searchParams.get('offset')
          const sql = `select to_jsonb(t.*) as row_json from ${table} as t ${where.sql} ${order}${limit ? ` limit ${Number(limit)}` : ''}${offset ? ` offset ${Number(offset)}` : ''}`
          return { status: 200, rows: await read(sql, where.params), always: true }
        }
        case 'POST': {
          const list = (Array.isArray(body) ? body : [body]) as Json[]
          const conflict = prefer.includes('resolution=merge-duplicates') ? url.searchParams.get('on_conflict') : null
          const out: Json[] = []
          for (const row of list) {
            const cols = Object.keys(row).map(ident)
            const conflictCols = conflict ? conflict.split(',').map(ident) : []
            const update = cols.filter((c) => !conflictCols.includes(c))
            const upsert = conflict
              ? ` on conflict (${conflictCols.join(', ')}) do ${update.length ? `update set ${update.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'nothing'}`
              : ''
            const sql = `insert into ${table} as t (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_record(null::${table}, $1::jsonb)${upsert} returning to_jsonb(t.*) as row_json`
            out.push(...(await read(sql, [JSON.stringify(row)])))
          }
          return { status: 201, rows: out, always: false }
        }
        case 'PATCH': {
          if (!where.sql) throw new HttpError(400, { code: '21000', message: 'UPDATE requires a WHERE clause' })
          const cols = Object.keys(body as Json).map(ident)
          const offset = where.params.length
          const sql = `update ${table} as t set ${cols.map((c) => `${c} = r.${c}`).join(', ')} from jsonb_populate_record(null::${table}, $${offset + 1}::jsonb) as r ${where.sql} returning to_jsonb(t.*) as row_json`
          return { status: 200, rows: await read(sql, [...where.params, JSON.stringify(body)]), always: false }
        }
        case 'DELETE': {
          if (!where.sql) throw new HttpError(400, { code: '21000', message: 'DELETE requires a WHERE clause' })
          return { status: 200, rows: await read(`delete from ${table} as t ${where.sql} returning to_jsonb(t.*) as row_json`, where.params), always: false }
        }
        default:
          throw new HttpError(405, { message: `Không hỗ trợ ${method}` })
      }
    })

    if ('rpcResult' in result) {
      return result.rpcResult === undefined ? empty(204) : json(200, result.rpcResult)
    }
    if (wantsObject) {
      if (result.rows.length !== 1) {
        throw new HttpError(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${result.rows.length} rows`, hint: null })
      }
      return json(result.status, result.rows[0])
    }
    if (!result.always && !representation) return empty(result.status === 201 ? 201 : 204)
    return json(result.status, result.rows)
  }

  private async rpc(tx: Tx, fn: string, args: Json): Promise<{ rpcResult: unknown }> {
    const meta = (
      await tx.query<{ retset: boolean; rettype: string }>(
        `select p.proretset as retset, t.typname as rettype from pg_proc p join pg_type t on t.oid = p.prorettype
         where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
        [fn],
      )
    ).rows[0]
    if (!meta) throw new HttpError(404, { code: 'PGRST202', message: `Không có hàm public.${fn}` })
    const names = Object.keys(args)
    const params = names.map((n) => (typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n]))
    const call = `public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}${typeof args[n] === 'object' && args[n] !== null ? '::jsonb' : ''}`).join(', ')})`
    if (meta.rettype === 'void') {
      await tx.query(`select ${call}`, params)
      return { rpcResult: undefined }
    }
    if (meta.retset) {
      return { rpcResult: (await tx.query<{ r: Json }>(`select to_jsonb(x) as r from ${call} as x`, params)).rows.map((r) => r.r) }
    }
    return { rpcResult: (await tx.query<{ r: unknown }>(`select to_jsonb(${call}) as r`, params)).rows[0]?.r ?? null }
  }
}

// ------------------------------------------------------------------ tiện ích

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }

function json(status: number, body: unknown): FakeResponse {
  return { status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function empty(status: number): FakeResponse {
  return { status, headers: CORS, body: '' }
}

/** sub trong JWT của header Authorization (publishable key không phải JWT → khách). */
function subject(headers: Record<string, string>): string | null {
  const token = (headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return (JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { sub?: string }).sub ?? null
  } catch {
    return null
  }
}

function statusOf(e: { code?: string; message: string }): number {
  switch (e.code) {
    case '23505':
    case '23503':
      return 409
    case '42501':
      return /row-level security/i.test(e.message) ? 403 : 401
    default:
      return 400
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

/** Dịch bộ lọc PostgREST (`date=gte.2026-08-01`, `or=(a.eq.x,b.eq.y)`, `archived_at=is.null`) thành SQL có tham số. */
function buildWhere(search: URLSearchParams): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const condition = (column: string, expr: string): string => {
    const col = `t.${ident(column)}`
    const dot = expr.indexOf('.')
    const op = expr.slice(0, dot)
    const value = expr.slice(dot + 1)
    if (op === 'is') {
      if (!['null', 'true', 'false'].includes(value)) throw new HttpError(400, { message: `is.${value} không hỗ trợ` })
      return `${col} is ${value}`
    }
    if (op === 'in') {
      const items = value.replace(/^\(|\)$/g, '').split(',')
      return `${col} in (${items.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`
    }
    const sqlOp = OPS[op]
    if (!sqlOp) throw new HttpError(400, { message: `Toán tử ${op} không hỗ trợ` })
    params.push(value)
    return `${col} ${sqlOp} $${params.length}`
  }

  const parts: string[] = []
  for (const [key, value] of search.entries()) {
    if (RESERVED.has(key)) continue
    if (key === 'or') {
      const inner = value.replace(/^\(|\)$/g, '').split(',')
      parts.push(
        `(${inner
          .map((item) => {
            const dot = item.indexOf('.')
            return condition(item.slice(0, dot), item.slice(dot + 1))
          })
          .join(' or ')})`,
      )
    } else {
      parts.push(condition(key, value))
    }
  }
  return { sql: parts.length ? `where ${parts.join(' and ')}` : '', params }
}

function buildOrder(order: string | null): string {
  if (!order) return ''
  return `order by ${order
    .split(',')
    .map((part) => {
      const [col, dir = 'asc', nulls] = part.split('.')
      return `t.${ident(col!)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
    })
    .join(', ')}`
}
