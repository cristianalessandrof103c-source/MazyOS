import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { extrairErroFuncao } from '../../lib/functions-error'

export function NewCarrosselJobDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tema, setTema] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('hub-generate-carrossel', {
        body: { tenant_id: tenantId, tema: tema.trim(), tipo: 'texto' },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao gerar carrossel')
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
          Qual o tema do carrossel?
          <input
            required
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            placeholder="Ex.: 3 erros que travam a prospecção de clientes"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus-within:border-violet"
          />
        </label>
        <p className="text-xs text-text-faint">
          A IA gera o texto dos slides e a legenda. Você revisa e edita antes de virar imagem.
        </p>

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 font-medium text-bg disabled:opacity-60"
        >
          {mutation.isPending ? 'Gerando texto…' : 'Gerar texto do carrossel'}
        </button>
      </form>
    </Modal>
  )
}
