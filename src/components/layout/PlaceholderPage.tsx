interface PlaceholderPageProps {
  title: string
  phase: number
}

/** Trang giữ chỗ cho tới khi giai đoạn tương ứng trong docs/09 được xây. */
export function PlaceholderPage({ title, phase }: PlaceholderPageProps) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">Trang này sẽ được xây ở giai đoạn {phase}.</p>
    </section>
  )
}
