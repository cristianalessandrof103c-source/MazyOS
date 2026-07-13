// Data helpers pra bucketizar séries por dia — usado pelos gráficos da Visão Geral.

/** Últimos `n` dias como 'YYYY-MM-DD', do mais antigo pro mais recente (hoje incluso). */
export function lastNDays(n: number): string[] {
  const days: string[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

/**
 * Soma (ou conta, se `getValue` não for passado) itens por dia, alinhado ao array `days`.
 * `getDate` deve retornar um timestamp ISO — só os 10 primeiros caracteres (YYYY-MM-DD) contam.
 */
export function bucketByDay<T>(
  items: T[],
  getDate: (item: T) => string,
  days: string[],
  getValue?: (item: T) => number,
): number[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    const day = getDate(item).slice(0, 10)
    const value = getValue ? getValue(item) : 1
    totals.set(day, (totals.get(day) ?? 0) + value)
  }
  return days.map((day) => totals.get(day) ?? 0)
}
