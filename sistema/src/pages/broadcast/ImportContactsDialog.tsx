import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { extrairErroFuncao } from '../../lib/functions-error'
import { normalizePhoneBR, PHONE_NOTE_LABELS } from '../../lib/phone'

const MAX_ROWS_PER_CHUNK = 2000
const PREVIEW_ROWS = 20

const NAME_HEADER_ALIASES = ['nome', 'name', 'full_name', 'cliente', 'contato', 'razao social', 'razão social']
const PHONE_HEADER_ALIASES = ['telefone', 'phone', 'celular', 'whatsapp', 'numero', 'número', 'fone', 'tel', 'contato_telefone']

function normalizeHeader(s: string): string {
  return s.toLowerCase().trim()
}

function detectarColuna(headers: string[], aliases: string[], fallbackIndex: number): string {
  const match = headers.find((h) => aliases.includes(normalizeHeader(h)))
  return match ?? headers[fallbackIndex] ?? headers[0] ?? ''
}

type ParsedFile = { headers: string[]; rows: Record<string, string>[] }
type ImportSummary = { inserted: number; skippedDuplicates: number; invalidPhones: { full_name: string; phone_number_raw: string; reason: string }[] }

export function ImportContactsDialog({ tenantId, listId, onClose }: { tenantId: string; listId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [nameColumn, setNameColumn] = useState('')
  const [phoneColumn, setPhoneColumn] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    setSummary(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        if (headers.length === 0 || results.data.length === 0) {
          setParseError('CSV vazio ou sem cabeçalho.')
          setParsed(null)
          return
        }
        setParsed({ headers, rows: results.data })
        setNameColumn(detectarColuna(headers, NAME_HEADER_ALIASES, 0))
        setPhoneColumn(detectarColuna(headers, PHONE_HEADER_ALIASES, 1))
      },
      error: (err) => setParseError(err.message),
    })
  }

  const preview = useMemo(() => {
    if (!parsed || !phoneColumn) return []
    return parsed.rows.slice(0, PREVIEW_ROWS).map((row) => ({
      fullName: row[nameColumn] ?? '',
      phoneRaw: row[phoneColumn] ?? '',
      normalized: normalizePhoneBR(row[phoneColumn] ?? ''),
    }))
  }, [parsed, nameColumn, phoneColumn])

  const invalidPreviewCount = preview.filter((p) => p.normalized.status === 'invalid').length

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error('Nenhum arquivo carregado.')

      const rows = parsed.rows.map((row) => {
        const extraFields: Record<string, string> = {}
        for (const header of parsed.headers) {
          if (header !== nameColumn && header !== phoneColumn) extraFields[header] = row[header] ?? ''
        }
        return {
          full_name: row[nameColumn] ?? '',
          phone_number: row[phoneColumn] ?? '',
          extra_fields: extraFields,
        }
      })

      let inserted = 0
      let skippedDuplicates = 0
      const invalidPhones: ImportSummary['invalidPhones'] = []

      for (let i = 0; i < rows.length; i += MAX_ROWS_PER_CHUNK) {
        const chunk = rows.slice(i, i + MAX_ROWS_PER_CHUNK)
        const { data, error } = await supabase.functions.invoke('broadcast-import-contacts', {
          body: { tenant_id: tenantId, list_id: listId, rows: chunk },
        })
        if (error) throw new Error(await extrairErroFuncao(error))
        if (!data?.ok) throw new Error(data?.error ?? 'Falha ao importar contatos')
        inserted += data.inserted ?? 0
        skippedDuplicates += data.skipped_duplicates ?? 0
        invalidPhones.push(...(data.invalid_phones ?? []))
      }

      return { inserted, skippedDuplicates, invalidPhones }
    },
    onSuccess: (result) => {
      setSummary(result)
      queryClient.invalidateQueries({ queryKey: ['broadcast-contacts-count', listId] })
      queryClient.invalidateQueries({ queryKey: ['broadcast-lists', tenantId] })
    },
  })

  return (
    <Modal title="Importar contatos via CSV" onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-4">
        {!parsed && (
          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Arquivo CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none file:mr-3 file:rounded-full file:border-0 file:bg-violet/15 file:px-3 file:py-1 file:text-violet"
            />
          </label>
        )}

        {parseError && <p className="text-sm text-magenta">{parseError}</p>}

        {parsed && !summary && (
          <>
            <p className="text-xs text-text-faint">{parsed.rows.length} linhas encontradas no arquivo.</p>

            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-text-dim">
                Coluna do nome
                <select
                  value={nameColumn}
                  onChange={(e) => setNameColumn(e.target.value)}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
                >
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-sm text-text-dim">
                Coluna do telefone
                <select
                  value={phoneColumn}
                  onChange={(e) => setPhoneColumn(e.target.value)}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
                >
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs text-text-faint">
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Telefone</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-text">{p.fullName || '—'}</td>
                      <td className="px-3 py-2 text-text-dim">{p.phoneRaw}</td>
                      <td className="px-3 py-2">
                        {p.normalized.status === 'invalid' ? (
                          <span className="text-magenta">rejeitado: {p.normalized.reason}</span>
                        ) : p.normalized.status === 'ok_international' ? (
                          <span className="text-text-faint">internacional</span>
                        ) : p.normalized.note ? (
                          <span className="text-cyan">{PHONE_NOTE_LABELS[p.normalized.note]}</span>
                        ) : (
                          <span className="text-text-faint">ok</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invalidPreviewCount > 0 && (
              <p className="text-xs text-text-faint">
                {invalidPreviewCount} de {preview.length} linhas na prévia serão rejeitadas — o restante do arquivo pode ter mais.
              </p>
            )}

            {importMutation.isError && <p className="text-sm text-magenta">{(importMutation.error as Error).message}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setParsed(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-dim hover:border-violet hover:text-text"
              >
                Trocar arquivo
              </button>
              <button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || !nameColumn || !phoneColumn}
                className="btn-primary px-4 py-2 text-sm"
              >
                {importMutation.isPending ? 'Importando…' : `Importar ${parsed.rows.length} contatos`}
              </button>
            </div>
          </>
        )}

        {summary && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">
              <span className="text-success">{summary.inserted}</span> contatos importados,{' '}
              <span className="text-text-dim">{summary.skippedDuplicates}</span> duplicados ignorados,{' '}
              <span className="text-magenta">{summary.invalidPhones.length}</span> rejeitados por telefone inválido.
            </p>
            {summary.invalidPhones.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border p-3 text-xs text-text-faint">
                {summary.invalidPhones.slice(0, 100).map((p, i) => (
                  <p key={i}>
                    {p.full_name} — {p.phone_number_raw} ({p.reason})
                  </p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="btn-primary self-start px-4 py-2 text-sm">
              Fechar
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
