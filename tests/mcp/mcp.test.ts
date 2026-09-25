// Máy chủ MCP (cổng kết nối Claude) — mô phỏng đúng những gì Claude làm: gọi HTTP có token OAuth,
// liệt kê công cụ, gọi công cụ. Dữ liệu nằm trong Postgres thật (PGlite + đủ migration + RLS).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toReplacePayload } from '../../src/data/backup'
import { buildDemoBackup, type DemoPersona } from '../../src/data/demo'
import { localDate } from '../../src/mcp/context'
import { createMcpHttpHandler } from '../../src/mcp/http'
import { lan } from '../../src/test/personas'
import { FakeBackend, SUPABASE_URL } from '../e2e/fake-backend'

const ORIGIN = 'https://tai-chinh.test'
const MCP_URL = `${ORIGIN}/api/mcp`
// 10:00 sáng 25/09/2026 giờ Việt Nam — cùng ngày với số liệu trong Sổ tay thực hành.
const NOW = new Date('2026-09-25T03:00:00Z')

let backend: FakeBackend
let handler: (request: Request) => Promise<Response>
const users: Record<DemoPersona, { id: string; token: string }> = {} as never

async function seedPersona(persona: DemoPersona) {
  const email = `${persona}@example.com`
  const id = await backend.createUser(email, 'matkhau123', { onboarded: true })
  const payload = toReplacePayload(buildDemoBackup(persona, localDate(NOW)))
  await backend.asUser(id, (tx) => tx.query('select public.replace_all_data($1::jsonb)', [JSON.stringify(payload)]))
  users[persona] = { id, token: backend.issueAccessToken(email, 'claude-client') }
}

async function connect(token: string) {
  const client = new Client({ name: 'claude-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => handler(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ json: Json; text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean }
  const text = result.content[0]!.text
  let json: Json
  try {
    json = JSON.parse(text)
  } catch {
    json = {} // thông báo lỗi dạng chữ, không phải JSON
  }
  return { json, text, isError: result.isError === true }
}

beforeAll(async () => {
  backend = await FakeBackend.create()
  handler = createMcpHttpHandler({ supabaseUrl: SUPABASE_URL, supabaseKey: 'sb_publishable_test', fetch: backend.fetch, now: () => NOW })
  await seedPersona('lan')
  await seedPersona('hung')
  await seedPersona('mai')
}, 120_000)

afterAll(() => backend.close())

describe('cổng HTTP & xác thực (đặc tả MCP authorization)', () => {
  it('protected resource metadata trỏ tới Supabase Auth làm máy chủ cấp quyền', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await handler(new Request(`${ORIGIN}${path}`))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ resource: MCP_URL, authorization_servers: [`${SUPABASE_URL}/auth/v1`], bearer_methods_supported: ['header'] })
    }
  })

  it('không có token → 401 + WWW-Authenticate chỉ đường tới metadata (Claude bắt đầu OAuth từ đây)', async () => {
    const res = await handler(new Request(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="email"`)
  })

  it('token giả / hết hạn → 401 invalid_token, không chạm dữ liệu', async () => {
    const forged = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000' })).toString('base64url'), 'x'].join('.')
    const res = await handler(new Request(MCP_URL, { method: 'POST', headers: { authorization: `Bearer ${forged}`, 'content-type': 'application/json' }, body: '{}' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('giờ Việt Nam: 01:00 ngày 25 (18:00 UTC ngày 24) vẫn là ngày 25', () => {
    expect(localDate(new Date('2026-09-24T18:00:00Z'))).toBe('2026-09-25')
    expect(localDate(new Date('2026-09-24T16:59:00Z'))).toBe('2026-09-24')
  })
})

describe('công cụ đọc — số liệu khớp app và docs/08', () => {
  it('liệt kê đủ công cụ, gắn nhãn đọc / ghi / xóa đúng', async () => {
    const client = await connect(users.lan.token)
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect([...byName.keys()].sort()).toEqual(
      [
        'add_transactions',
        'create_account',
        'delete_transaction',
        'get_budget',
        'get_debts',
        'get_financial_overview',
        'get_monthly_report',
        'get_savings_and_investments',
        'get_trends',
        'list_accounts',
        'list_categories',
        'search_transactions',
        'set_budget',
        'update_investment_prices',
        'update_transaction',
      ].sort(),
    )
    expect(byName.get('get_financial_overview')!.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('add_transactions')!.annotations?.readOnlyHint).toBe(false)
    expect(byName.get('delete_transaction')!.annotations?.destructiveHint).toBe(true)
    expect(client.getInstructions()).toContain('Số tiền là số nguyên đồng')
  })

  it('Lan — tổng quan: net worth cuối tháng 8 = 43.250.000, tiết kiệm 31,9% (Tốt), quỹ khẩn cấp Cần chú ý', async () => {
    const { json } = await call(await connect(users.lan.token), 'get_financial_overview')
    expect(json.today).toBe('2026-09-25')
    expect(json.net_worth.at_end_of_last_period).toBe(43_250_000)
    expect(json.health.measured_month).toBe('2026-08')
    expect(json.health.savings_rate.value).toBeCloseTo(0.3194, 3)
    expect(json.health.savings_rate.rating_text).toBe('Tốt')
    expect(json.health.emergency_fund_months.rating).toBe('attention')
    expect(json.insights.some((i: Json) => /Quỹ khẩn cấp đủ cho/.test(i.message))).toBe(true)
  })

  it('Lan — báo cáo tháng 8: thu 18 tr, chi 12,25 tr, cơ cấu 50/30/20, net worth 0 → 43,25 tr', async () => {
    const { json } = await call(await connect(users.lan.token), 'get_monthly_report', { month: '2026-08' })
    expect(json).toMatchObject({ income: 18_000_000, expense: 12_250_000, net_cash_flow: 5_750_000, complete: true })
    expect(json.rule_50_30_20.needs).toBeCloseTo(0.564, 3)
    expect(json.rule_50_30_20.savings_and_debt).toBeCloseTo(0.319, 3)
    // Thác nước tách hoàn tiền (200.000 ₫ ngày 18/08) khỏi chi tiêu: −12.450.000 + 200.000 = −12.250.000 như trên app.
    expect(json.net_worth_change).toMatchObject({ start: 0, opening_balances_of_new_accounts: 37_500_000, income: 18_000_000, expense: -12_450_000, refunds: 200_000, end: 43_250_000 })
    expect(json.top_spending[0]).toMatchObject({ category: 'Nhà ở', amount: 5_000_000 })
    expect(json.budget.over_budget.map((l: Json) => l.name).sort()).toEqual(['Giải trí', 'Ăn uống'])
  })

  it('Lan — ngân sách tháng 9: Ăn uống 3.150.000 (gồm −350.000 chuyển từ tháng 8)', async () => {
    const { json } = await call(await connect(users.lan.token), 'get_budget')
    expect(json).toMatchObject({ month: '2026-09', exists: true, expected_income: 18_000_000, unassigned: 2_500_000 })
    expect(json.lines.find((l: Json) => l.name === 'Ăn uống')).toMatchObject({ planned: 3_500_000, carried_from_last_month: -350_000, budget: 3_150_000 })
  })

  it('tìm giao dịch theo danh mục + chữ, và xuất CSV', async () => {
    const client = await connect(users.lan.token)
    const { json } = await call(client, 'search_transactions', { month: '2026-08', category: 'an uong' })
    const p = lan()
    expect(json.count).toBe(p.transactions.filter((t) => t.categoryId === p.categoryId('Ăn uống')).length)
    expect(json.total_expense_net_of_refunds).toBe(3_850_000)
    const csv = await call(client, 'search_transactions', { month: '2026-08', format: 'csv' })
    expect(csv.text.split('\r\n')[0]).toBe('Ngày,Loại,Tài khoản,Tài khoản nhận,Danh mục,Số tiền,Ghi chú,Thẻ')
  })

  it('Hùng — khoản vay: dư nợ 1.195.000.000, kỳ 10/09 quá hạn = gốc 5.000.000 + lãi 8.962.500', async () => {
    const { json } = await call(await connect(users.hung.token), 'get_debts')
    expect(json.loans[0]).toMatchObject({ name: 'Vay mua nhà', outstanding: 1_195_000_000, annual_rate: 0.09 })
    expect(json.loans[0].next_payment).toEqual({ due_date: '2026-09-10', principal: 5_000_000, interest: 8_962_500, total: 13_962_500, overdue: true })
  })

  it('Mai — đầu tư: FPT 900 cp, giá vốn 116.000, lãi chưa thực hiện +8.100.000, đã thực hiện +8.400.000', async () => {
    const { json } = await call(await connect(users.mai.token), 'get_savings_and_investments')
    const fpt = json.investment_accounts[0].holdings.find((h: Json) => h.symbol === 'FPT')
    expect(fpt).toMatchObject({ quantity: 900, average_cost: 116_000, price: 125_000, market_value: 112_500_000, unrealized_gain: 8_100_000, realized_gain: 8_400_000, price_is_stale: true })
  })
})

describe('công cụ ghi — ghi từ hóa đơn, chống trùng, kiểm tra như form trong app', () => {
  it('ghi 1 hóa đơn → lưu đúng, gắn thẻ "claude", số dư cập nhật; gửi lại cùng request_id không ghi trùng', async () => {
    const client = await connect(users.lan.token)
    const receipt = { type: 'expense', amount: 65_000, date: '2026-09-25', account: 'tien mat', category: 'Ăn uống', note: 'Highlands Coffee — HĐ 0012345', request_id: 'HD-0012345' }
    const first = await call(client, 'add_transactions', { transactions: [receipt] })
    expect(first.json).toMatchObject({ status: 'saved', saved_count: 1 })
    expect(first.json.transactions[0]).toMatchObject({ account: 'Tiền mặt', category: 'Ăn uống', amount: 65_000, tags: ['claude'] })
    const rows = await backend.rows(users.lan.id, `select amount, note, tags, idempotency_key from public.transactions where note like 'Highlands%'`)
    expect(rows).toEqual([{ amount: 65_000, note: 'Highlands Coffee — HĐ 0012345', tags: ['claude'], idempotency_key: 'claude:HD-0012345' }])

    const again = await call(client, 'add_transactions', { transactions: [receipt] })
    expect(again.json).toMatchObject({ status: 'not_saved', reason: 'invalid' })
    expect(again.json.problems[0].errors[0]).toContain('đã được ghi trước đó')

    // Cùng hóa đơn nhưng không có mã: nghi trùng → hỏi người dùng; đồng ý thì mới lưu.
    const { request_id: _r, ...noKey } = receipt
    const dup = await call(client, 'add_transactions', { transactions: [noKey] })
    expect(dup.json).toMatchObject({ status: 'not_saved', reason: 'needs_user_confirmation' })
    expect(dup.json.problems[0].possible_duplicates[0].note).toBe('Highlands Coffee — HĐ 0012345')
    const forced = await call(client, 'add_transactions', { transactions: [noKey], allow_duplicates: true })
    expect(forced.json.status).toBe('saved')
    expect(await backend.rows(users.lan.id, `select id from public.transactions where note like 'Highlands%'`)).toHaveLength(2)
  })

  it('tất cả hoặc không: một khoản sai (danh mục không có) → không khoản nào được lưu, kèm danh sách gợi ý', async () => {
    const client = await connect(users.lan.token)
    const before = await backend.rows(users.lan.id, 'select id from public.transactions')
    const { json } = await call(client, 'add_transactions', {
      transactions: [
        { type: 'expense', amount: 30_000, account: 'Tiền mặt', category: 'Đi lại', note: 'Grab' },
        { type: 'expense', amount: 99_000, account: 'Tiền mặt', category: 'Du hành vũ trụ' },
      ],
    })
    expect(json).toMatchObject({ status: 'not_saved', reason: 'invalid' })
    expect(json.problems).toHaveLength(1)
    expect(json.problems[0].index).toBe(1)
    expect(json.problems[0].errors[0]).toMatch(/Không tìm thấy danh mục chi "Du hành vũ trụ"\. Hiện có: .*Ăn uống/)
    expect(await backend.rows(users.lan.id, 'select id from public.transactions')).toHaveLength(before.length)
  })

  it('cùng quy tắc như app: tiền mặt không được âm; gọi tên nhóm thì phải chọn danh mục con', async () => {
    const client = await connect(users.lan.token)
    const cash = await call(client, 'add_transactions', { transactions: [{ type: 'expense', amount: 50_000_000, account: 'Tiền mặt', category: 'Mua sắm' }] })
    expect(cash.json.problems[0].errors[0]).toMatch(/Tiền mặt "Tiền mặt" sẽ bị âm/)
    const group = await call(client, 'add_transactions', { transactions: [{ type: 'expense', amount: 10_000, account: 'Tiền mặt', category: 'Tài chính' }] })
    expect(group.json.problems[0].errors[0]).toBe('"Tài chính" là nhóm — hãy chọn một danh mục con: Lãi vay, Phí trả nợ trước hạn, Phí ngân hàng, Phí & thuế đầu tư.') // đúng thứ tự trong app
  })

  it('chuyển tiền (rút ATM) không làm thay đổi net worth; chi tiêu làm giảm đúng số tiền', async () => {
    const client = await connect(users.lan.token)
    const nw = async () => (await call(client, 'get_financial_overview')).json.net_worth.value as number
    const start = await nw()
    await call(client, 'add_transactions', { transactions: [{ type: 'transfer', amount: 500_000, account: 'Vietcombank', to_account: 'Tiền mặt' }] })
    expect(await nw()).toBe(start)
    await call(client, 'add_transactions', { transactions: [{ type: 'expense', amount: 120_000, account: 'Tiền mặt', category: 'Đi lại', note: 'Xăng' }] })
    expect(await nw()).toBe(start - 120_000)
  })

  it('sửa và xóa giao dịch; giao dịch thuộc nghiệp vụ nhiều phần (trả nợ) được bảo vệ', async () => {
    const lanClient = await connect(users.lan.token)
    const found = await call(lanClient, 'search_transactions', { text: 'xang' })
    const id = found.json.transactions[0].id as string
    const upd = await call(lanClient, 'update_transaction', { id, amount: 150_000, note: 'Xăng RON95' })
    expect(upd.json).toMatchObject({ status: 'saved', before: { amount: 120_000 }, after: { amount: 150_000, note: 'Xăng RON95' } })
    const del = await call(lanClient, 'delete_transaction', { id })
    expect(del.json).toMatchObject({ status: 'deleted', transaction: { id } })
    expect(await backend.rows(users.lan.id, 'select id from public.transactions where id = $1', [id])).toEqual([])

    const hungClient = await connect(users.hung.token)
    const interest = (await call(hungClient, 'search_transactions', { from: '2026-01-01', category: 'Lãi vay' })).json.transactions[0]
    expect(interest.part_of_group).toBe(true)
    const blocked = await call(hungClient, 'delete_transaction', { id: interest.id })
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toContain('nghiệp vụ nhiều phần')
  })

  it('ngân sách: tạo tháng 10 bằng sao chép tháng 9, sửa một dòng, bỏ một dòng', async () => {
    const client = await connect(users.lan.token)
    const created = await call(client, 'set_budget', { month: '2026-10', lines: [{ category: 'Ăn uống', planned: 4_000_000 }, { category: 'Giải trí', planned: 0 }] })
    expect(created.json).toMatchObject({ status: 'created', month: '2026-10', expected_income: 18_000_000 })
    const names = created.json.lines.map((l: Json) => l.name)
    expect(names).toContain('Nhà ở')
    expect(names).not.toContain('Giải trí')
    expect(created.json.lines.find((l: Json) => l.name === 'Ăn uống').planned).toBe(4_000_000)
  })

  it('thêm tài khoản; cập nhật giá cổ phiếu từ ảnh chụp app chứng khoán', async () => {
    const lanClient = await connect(users.lan.token)
    const acc = await call(lanClient, 'create_account', { name: 'ZaloPay', kind: 'ewallet', opening_balance: 200_000 })
    expect(acc.json).toMatchObject({ status: 'created', account: { name: 'ZaloPay', kind_text: 'Ví điện tử', balance: 200_000, tracked_since: '2026-09-25' } })

    const maiClient = await connect(users.mai.token)
    const wrong = await call(maiClient, 'update_investment_prices', { prices: [{ symbol: 'VNM', price: 60_000 }] })
    expect(wrong.text).toBe('Không có mã VNM trong danh mục. Mã đang có: FPT.')
    const { json } = await call(maiClient, 'update_investment_prices', { prices: [{ symbol: 'fpt', price: 130_000 }] })
    expect(json.holdings[0]).toMatchObject({ symbol: 'FPT', price: 130_000, market_value: 117_000_000, unrealized_gain: 12_600_000 })
    expect(json.net_worth_today).toBe(470_544_000)
  })
})

describe('cách ly dữ liệu (RLS) — token của ai chỉ thấy dữ liệu người đó', () => {
  it('Hùng không đọc, không sửa, không xóa được giao dịch của Lan dù biết id', async () => {
    const lanTx = (await backend.rows(users.lan.id, 'select id from public.transactions limit 1'))[0]!.id as string
    const hungClient = await connect(users.hung.token)
    const accounts = (await call(hungClient, 'list_accounts')).json.accounts.map((a: Json) => a.name)
    expect(accounts).not.toContain('MoMo')
    expect((await call(hungClient, 'delete_transaction', { id: lanTx })).text).toContain('Không tìm thấy giao dịch')
    expect((await call(hungClient, 'update_transaction', { id: lanTx, amount: 1 })).text).toContain('Không tìm thấy giao dịch')
    expect(await backend.rows(users.lan.id, 'select id from public.transactions where id = $1', [lanTx])).toHaveLength(1)
  })
})
