// Tiện ích nhỏ nhớ theo trình duyệt (tài khoản dùng gần nhất, danh mục gần đây, bước onboarding).
// Không bao giờ chứa dữ liệu tài chính; lỗi truy cập localStorage (chế độ ẩn danh…) được bỏ qua.

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`tccn:${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`tccn:${key}`, JSON.stringify(value))
  } catch {
    // bỏ qua
  }
}

/** Đưa `id` lên đầu danh sách gần đây (tối đa `max`). */
export function pushRecent(key: string, id: string, max = 5): void {
  const list = readPref<string[]>(key, []).filter((x) => x !== id)
  writePref(key, [id, ...list].slice(0, max))
}
