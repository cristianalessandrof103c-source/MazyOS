import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'

const PREFIXO_PASTA = 'marketing/conteudo/'

export function NewCarrosselJobDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [pasta, setPasta] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('integration_hub_jobs').insert({
        tenant_id: tenantId,
        tool: 'carrossel',
        status: 'pending',
        params: { pasta: `${PREFIXO_PASTA}${pasta.trim()}` },
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hub-jobs', tenantId] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <Modal title="Gerar carrossel" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Pasta do conteúdo (já criada via /carrossel)
          <div className="flex items-center rounded-lg border border-border bg-surface-2 focus-within:border-violet">
            <span className="pl-3 text-text-faint">{PREFIXO_PASTA}</span>
            <input
              required
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              placeholder="carrossel-tema-2026-07-08"
              className="w-full bg-transparent px-1 py-2 pr-3 text-text outline-none"
            />
          </div>
        </label>

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 font-medium text-bg disabled:opacity-60"
        >
          {mutation.isPending ? 'Criando…' : 'Criar job'}
        </button>
      </form>
    </Modal>
  )
}
