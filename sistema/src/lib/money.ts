export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100)
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100
}

export function formatarReais(centavos: number): string {
  return centavosParaReais(centavos).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
