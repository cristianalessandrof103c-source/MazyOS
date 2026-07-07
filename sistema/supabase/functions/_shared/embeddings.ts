// Embeddings via Voyage AI (parceiro recomendado pela Anthropic — ver plano).
// Troca de provedor (ex: OpenAI text-embedding-3-small) não muda o resto da
// arquitetura, só essa função — mas o vector(512) na migration 0007 tá
// dimensionado pro voyage-3-lite; mudar de modelo/dimensão exige nova migration.

const VOYAGE_API_KEY = Deno.env.get('VOYAGE_API_KEY') ?? ''
const EMBEDDING_MODEL = Deno.env.get('EMBEDDING_MODEL') || 'voyage-3-lite'

export async function embedText(text: string, inputType: 'query' | 'document' = 'document'): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error ? (data.error.message ?? JSON.stringify(data.error)) : `HTTP ${res.status}`
    throw new Error(`Voyage embeddings falhou: ${msg}`)
  }
  return data.data[0].embedding as number[]
}
