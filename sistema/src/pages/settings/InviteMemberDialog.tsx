import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/Modal'
import { extrairErroFuncao } from '../../lib/functions-error'
import { ROLE_LABEL } from '../../lib/membership-roles'
import type { MembershipRole } from '../../lib/crm-types'

export function InviteMemberDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MembershipRole>('tenant_agent')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: {
          tenant_id: tenantId,
          email: email.trim(),
          role,
          redirect_to: `${window.location.origin}/login`,
        },
      })
      if (error) throw new Error(await extrairErroFuncao(error))
      if (!data?.ok) throw new Error(data?.error ?? 'Falha ao convidar')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-memberships', tenantId] })
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <Modal title="Convidar membro" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-text-dim">
          Papel
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
          >
            {(Object.keys(ROLE_LABEL) as MembershipRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
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
          {mutation.isPending ? 'Convidando…' : 'Convidar'}
        </button>
      </form>
    </Modal>
  )
}
