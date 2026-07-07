import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import type { AcquisitionChannel } from '../../lib/crm-types'

export function NewLeadDialog({
  tenantId,
  newStageId,
  channels,
  onClose,
}: {
  tenantId: string
  newStageId: string
  channels: AcquisitionChannel[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('leads').insert({
        tenant_id: tenantId,
        full_name: fullName,
        phone_number: phone || null,
        email: email || null,
        acquisition_channel_id: channelId || null,
        stage_id: newStageId,
      })
      if (error) throw error
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
    <Modal title="Novo lead" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Nome
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Telefone
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 63 9...."
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Canal de origem
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-magenta">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="mt-2 rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 font-medium text-bg disabled:opacity-60"
        >
          {mutation.isPending ? 'Criando…' : 'Criar lead'}
        </button>
      </form>
    </Modal>
  )
}
