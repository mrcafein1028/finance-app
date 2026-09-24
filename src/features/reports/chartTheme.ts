// Màu biểu đồ theo vai trò — trỏ tới token CSS (index.css) nên tự đổi theo chế độ sáng/tối.
export const S = {
  1: 'var(--color-series-1)',
  2: 'var(--color-series-2)',
  3: 'var(--color-series-3)',
  4: 'var(--color-series-4)',
  5: 'var(--color-series-5)',
  ink: 'var(--color-ink)',
  muted: 'var(--color-muted)',
  grid: 'var(--color-grid)',
  surface: 'var(--color-surface)',
}

/** Thứ tự cố định cho dữ liệu phân loại — không bao giờ xoay vòng quá 5 màu (gộp phần còn lại thành "Khác"). */
export const PIE_COLORS = [S[1], S[2], S[3], S[4], S[5]]

export const allocationColor = (i: number) => PIE_COLORS[i % PIE_COLORS.length]!
