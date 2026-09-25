// Dựng thư mục .vercel/output theo Build Output API v3 của Vercel, chạy sau `vite build`:
//   static/            ← web app (dist/)
//   functions/api/mcp.func/  ← máy chủ MCP cho Claude, gói cùng mọi thư viện thành MỘT file
//   config.json        ← định tuyến: metadata OAuth, file tĩnh, còn lại về index.html (SPA)
//
// Vì sao tự gói thay vì để Vercel biên dịch thư mục api/: Vercel biên dịch từng file .ts riêng lẻ và
// giữ nguyên đường dẫn import không đuôi (./foo) của code dùng chung trong src/ → Node ESM báo
// ERR_MODULE_NOT_FOUND khi chạy. Một file đã gói sẵn không có vấn đề đó.
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = `${root}.vercel/output`
const fn = `${out}/functions/api/mcp.func`

await stat(`${root}dist/index.html`).catch(() => {
  throw new Error('Chưa có dist/ — chạy `vite build` trước (npm run build làm cả hai).')
})
await rm(out, { recursive: true, force: true })
await mkdir(fn, { recursive: true })
await cp(`${root}dist`, `${out}/static`, { recursive: true })

await build({
  input: `${root}src/mcp/node/vercel.ts`,
  platform: 'node',
  logLevel: 'warn',
  transform: { define: { 'process.env.NODE_ENV': '"production"' } },
  output: {
    dir: fn,
    format: 'esm',
    entryFileNames: 'index.mjs',
    chunkFileNames: '[name]-[hash].mjs',
    // Vài thư viện CommonJS bên trong gọi require() — cấp require cho chúng trong file ESM.
    banner: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})

await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: false, maxDuration: 30 }, null, 2),
)
await writeFile(`${fn}/package.json`, JSON.stringify({ type: 'module' }))

await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Claude tìm "protected resource metadata" ở đây (RFC 9728) → do chính hàm MCP trả lời.
        { src: '^/\\.well-known/oauth-protected-resource(?:/.*)?$', dest: '/api/mcp?resource_metadata=1' },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/api/(.*)$', status: 404 },
        // SPA: mọi đường dẫn khác (VD /budget, /oauth/consent) trả về index.html.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)

const size = (await stat(`${fn}/index.mjs`)).size
console.log(`✓ .vercel/output: web tĩnh + hàm /api/mcp (${(size / 1024).toFixed(0)} KB)`)
