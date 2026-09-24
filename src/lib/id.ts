/** UUID v4 — khớp kiểu uuid của Postgres. Có sẵn trong trình duyệt hiện đại và Node ≥ 19. */
export function newId(): string {
  return crypto.randomUUID()
}
