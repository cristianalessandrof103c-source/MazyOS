import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Prospect, ProspectStatus } from '../../lib/crm-types'

const STATUS_LABEL: Record<ProspectStatus, string> = {
  novo: 'Novo',
  contatado: 'Contatado',
  qualificado: 'Qualificado',
  descartado: 'Descartado',
  convertido: 'Convertido',
}

const EDITABLE_STATUSES: ProspectStatus[] = ['novo', 'contatado', 'qualificado', 'descartado']

export function ProspectRow({ tenantId, prospect }: { tenantId: string; prospect: Prospect }) {
  const queryClient = useQueryClient()

  const statusMutation = useMutation({
    mutationFn: async (status: ProspectStatus) => {
      const { error } = await supabase.from('prospects').update({ status }).eq('id', prospect.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] }),
  })

  const convertMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('convert_prospect_to_lead', { p_prospect_id: prospect.id })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospects', tenantId] })
      queryClient.invalidateQueries({ queryKey: ['leads', tenantId] })
    },
  })

  const isConverted = prospect.status === 'convertido'

  return (
    <li className="rounded-xl border border-border bg-surface-2 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{prospect.name}</p>
          <p className="mt-0.5 text-xs text-text-faint">
            {prospect.phone_number ?? 'sem telefone'}
            {prospect.formatted_address && ` · ${prospect.formatted_address}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {prospect.website && (
              <a href={prospect.website} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                Site
              </a>
            )}
            {prospect.instagram_url && (
              <a href={prospect.instagram_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                Instagram
              </a>
            )}
            {prospect.linkedin_url && (
              <a href={prospect.linkedin_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                LinkedIn
              </a>
            )}
            {prospect.google_maps_url && (
              <a href={prospect.google_maps_url} target="_blank" rel="noreferrer" className="text-text-faint hover:underline">
                Google Maps
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {isConverted ? (
            <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs text-cyan">Convertido</span>
          ) : (
            <select
              value={prospect.status}
              onChange={(e) => statusMutation.mutate(e.target.value as ProspectStatus)}
              className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text-dim outline-none"
            >
              {EDITABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          )}

          {!isConverted && (
            <button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending}
              className="whitespace-nowrap rounded-full border border-violet/40 px-2 py-1 text-xs text-violet hover:bg-violet/10 disabled:opacity-60"
            >
              {convertMutation.isPending ? 'Convertendo…' : 'Converter em lead'}
            </button>
          )}
          {convertMutation.isError && (
            <p className="max-w-[12rem] text-right text-xs text-magenta">{(convertMutation.error as Error).message}</p>
          )}
        </div>
      </div>
    </li>
  )
}
