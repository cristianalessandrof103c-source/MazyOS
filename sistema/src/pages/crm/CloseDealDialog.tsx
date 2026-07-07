import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { reaisParaCentavos } from '../../lib/money'
import type { Lead, PipelineStage } from '../../lib/crm-types'

export function CloseDealDialog({
  tenantId,
  lead,
  wonStage,
  lostStage,
  onClose,
}: {
  tenantId: string
  lead: Lead
  wonStage: PipelineStage
  lostStage: PipelineStage
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<'won' | 'lost'>('won')
  const [valueReais, setValueReais] = useState('')
  const [paidNow, setPaidNow] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const valueCents = outcome === 'won' ? reaisParaCentavos(Number(valueReais) || 0) : 0

      const { data: deal, error: dealError } = await supabase
        .from('deals')
        .insert({
          tenant_id: tenantId,
          lead_id: lead.id,
          status: outcome,
          value_cents: valueCents,
          acquisition_channel_id: lead.acquisition_channel_id,
          closed_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (dealError) throw dealError

      if (outcome === 'won' && valueCents > 0) {
        const { error: paymentError } = await supabase.from('payments').insert({
          tenant_id: tenantId,
          deal_id: deal.id,
          amount_cents: valueCents,
          status: paidNow ? 'paid' : 'pending',
          paid_at: paidNow ? new Date().toISOString() : null,
        })
        if (paymentError) throw paymentError
      }

      const { error: leadError } = await supabase
        .from('leads')
        .update({ stage_id: outcome === 'won' ? wonStage.id : lostStage.id })
        .eq('id', lead.id)
      if (leadError) throw leadError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', tenantId] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <Modal title={`Registrar venda — ${lead.full_name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={outcome === 'won'}
              onChange={() => setOutcome('won')}
            />
            Ganhou
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={outcome === 'lost'}
              onChange={() => setOutcome('lost')}
            />
            Perdeu
          </label>
        </div>

        {outcome === 'won' && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-text-dim">
              Valor da venda (R$)
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={valueReais}
                onChange={(e) => setValueReais(e.target.value)}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-text-dim">
              <input
                type="checkbox"
                checked={paidNow}
                onChange={(e) => setPaidNow(e.target.checked)}
              />
              Já foi pago agora (senão fica como "a receber")
            </label>
          </>
        )}

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 font-medium text-bg disabled:opacity-60"
        >
          {mutation.isPending ? 'Salvando…' : 'Confirmar'}
        </button>
      </form>
    </Modal>
  )
}
