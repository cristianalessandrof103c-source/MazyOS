import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { extrairErroFuncao } from '../../lib/functions-error'
import type { ButtonInput } from '../../lib/broadcast-types'

const CATEGORY_OPTIONS = [
  { value: 'MARKETING', label: 'Marketing (promoção, oferta)' },
  { value: 'UTILITY', label: 'Utilidade (atualização, aviso)' },
  { value: 'AUTHENTICATION', label: 'Autenticação (código de verificação)' },
]

const BUTTON_TYPE_OPTIONS = [
  { value: 'QUICK_REPLY', label: 'Resposta rápida' },
  { value: 'URL', label: 'Link' },
  { value: 'PHONE_NUMBER', label: 'Telefone' },
]

function extractVariableCount(text: string): number {
  return new Set(Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size
}

export function NewTemplateDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('pt_BR')
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING')
  const [headerText, setHeaderText] = useState('')
  const [headerExample, setHeaderExample] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [bodyExamples, setBodyExamples] = useState<string[]>([])
  const [footerText, setFooterText] = useState('')
  const [buttons, setButtons] = useState<ButtonInput[]>([])
  const [error, setError] = useState<string | null>(null)

  const bodyVariableCount = useMemo(() => extractVariableCount(bodyText), [bodyText])
  const headerVariableCount = useMemo(() => extractVariableCount(headerText), [headerText])

  function updateBodyExample(index: number, value: string) {
    setBodyExamples((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  function addButton() {
    setButtons((prev) => (prev.length >= 3 ? prev : [...prev, { type: 'QUICK_REPLY', text: '' }]))
  }

  function updateButton(index: number, patch: Partial<ButtonInput>) {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  function removeButton(index: number) {
    setButtons((prev) => prev.filter((_, i) => i !== index))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-templates', {
        body: {
          tenant_id: tenantId,
          action: 'create',
          name: name.trim(),
          language: language.trim(),
          category,
          header_text: headerText.trim() || undefined,
          header_example: headerExample.trim() || undefined,
          body_text: bodyText.trim(),
          body_examples: bodyExamples.slice(0, bodyVariableCount),
          footer_text: footerText.trim() || undefined,
          buttons: buttons.filter((b) => b.text.trim()),
        },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao criar template')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates', tenantId] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (headerVariableCount > 1) {
      setError('Cabeçalho só pode ter no máximo 1 variável ({{1}}).')
      return
    }
    mutation.mutate()
  }

  return (
    <Modal title="Novo template (enviado direto pra Meta)" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-xs text-text-faint">
          Depois de criado, o template fica "Em análise" até a Meta aprovar — normalmente minutos, às vezes mais.
        </p>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-text-dim">
            Nome (sem espaço/maiúscula)
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="promocao_julho"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5 text-sm text-text-dim">
            Idioma
            <input
              required
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Cabeçalho (opcional, só texto)
          <input
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            placeholder="Ex: Promoção especial {{1}}"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>
        {headerVariableCount > 0 && (
          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Exemplo da variável do cabeçalho
            <input
              value={headerExample}
              onChange={(e) => setHeaderExample(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Corpo da mensagem — use {'{{1}}, {{2}}...'} pra variáveis
          <textarea
            required
            rows={4}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Olá {{1}}, tudo bem? Vi que a {{2}} pode se beneficiar do nosso serviço…"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        {bodyVariableCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-xs text-text-faint">Exemplo de cada variável (só pra revisão da Meta, não é dado real):</p>
            {Array.from({ length: bodyVariableCount }).map((_, i) => (
              <label key={i} className="flex flex-col gap-1 text-xs text-text-dim">
                {`{{${i + 1}}}`}
                <input
                  required
                  value={bodyExamples[i] ?? ''}
                  onChange={(e) => updateBodyExample(i, e.target.value)}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-text outline-none focus:border-violet"
                />
              </label>
            ))}
          </div>
        )}

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Rodapé (opcional)
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-dim">Botões (opcional, máx. 3)</p>
            {buttons.length < 3 && (
              <button type="button" onClick={addButton} className="text-xs text-violet hover:underline">
                + Adicionar botão
              </button>
            )}
          </div>
          {buttons.map((btn, i) => (
            <div key={i} className="flex items-end gap-2 rounded-lg border border-border p-2">
              <label className="flex w-32 flex-col gap-1 text-xs text-text-dim">
                Tipo
                <select
                  value={btn.type}
                  onChange={(e) => updateButton(i, { type: e.target.value as ButtonInput['type'] })}
                  className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-text outline-none focus:border-violet"
                >
                  {BUTTON_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-text-dim">
                Texto do botão
                <input
                  value={btn.text}
                  onChange={(e) => updateButton(i, { text: e.target.value })}
                  className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-text outline-none focus:border-violet"
                />
              </label>
              {btn.type === 'URL' && (
                <label className="flex flex-1 flex-col gap-1 text-xs text-text-dim">
                  URL
                  <input
                    value={btn.url ?? ''}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                    placeholder="https://…"
                    className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-text outline-none focus:border-violet"
                  />
                </label>
              )}
              {btn.type === 'PHONE_NUMBER' && (
                <label className="flex flex-1 flex-col gap-1 text-xs text-text-dim">
                  Telefone
                  <input
                    value={btn.phone_number ?? ''}
                    onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                    placeholder="+5547…"
                    className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-text outline-none focus:border-violet"
                  />
                </label>
              )}
              <button type="button" onClick={() => removeButton(i)} className="px-2 py-1.5 text-xs text-text-faint hover:text-magenta">
                Remover
              </button>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button type="submit" disabled={mutation.isPending} className="btn-primary mt-2 px-4 py-2.5">
          {mutation.isPending ? 'Enviando pra Meta…' : 'Criar template'}
        </button>
      </form>
    </Modal>
  )
}
