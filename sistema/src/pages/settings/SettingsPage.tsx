import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useCompanyBranding } from '../../hooks/useCompanyBranding'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { InviteMemberDialog } from './InviteMemberDialog'
import { ROLE_LABEL } from '../../lib/membership-roles'
import type { Membership, Profile } from '../../lib/crm-types'

const STATUS_LABEL: Record<Membership['status'], string> = {
  invited: 'Convite pendente',
  active: 'Ativo',
  disabled: 'Desativado',
}

const STATUS_STYLE: Record<Membership['status'], string> = {
  invited: 'bg-surface-2 text-text-dim',
  active: 'bg-cyan/15 text-cyan',
  disabled: 'bg-magenta/15 text-magenta',
}

export function SettingsPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { user, isPlatformAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('#8b5cf6')
  const [logoUrl, setLogoUrl] = useState('')
  const [brandingInitialized, setBrandingInitialized] = useState(false)
  const [brandingError, setBrandingError] = useState<string | null>(null)

  const brandingQuery = useCompanyBranding(tenantId)

  const myMembershipQuery = useQuery({
    queryKey: ['my-membership', tenantId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('role')
        .eq('tenant_id', tenantId)
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      if (error) throw error
      return data as { role: Membership['role'] } | null
    },
    enabled: Boolean(tenantId && user),
  })

  const membershipsQuery = useQuery({
    queryKey: ['team-memberships', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Membership[]
    },
    enabled: Boolean(tenantId),
  })

  const activeUserIds = (membershipsQuery.data ?? []).filter((m) => m.status !== 'invited').map((m) => m.user_id)

  const profilesQuery = useQuery({
    queryKey: ['team-profiles', activeUserIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', activeUserIds)
      if (error) throw error
      return data as Profile[]
    },
    enabled: activeUserIds.length > 0,
  })

  const brandingMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_company_branding', {
        p_tenant_id: tenantId,
        p_branding: { primary_color: primaryColor, logo_url: logoUrl || undefined },
      })
      if (error) throw error
    },
    onSuccess: () => {
      setBrandingError(null)
      queryClient.invalidateQueries({ queryKey: ['company-branding', tenantId] })
    },
    onError: (err: Error) => setBrandingError(err.message),
  })

  useEffect(() => {
    if (brandingQuery.data && !brandingInitialized) {
      setPrimaryColor(brandingQuery.data.branding_json.primary_color ?? '#8b5cf6')
      setLogoUrl(brandingQuery.data.branding_json.logo_url ?? '')
      setBrandingInitialized(true)
    }
  }, [brandingQuery.data, brandingInitialized])

  if (!tenantId) return null

  const isTenantAdmin = isPlatformAdmin || myMembershipQuery.data?.role === 'tenant_admin'
  const nameByUserId = new Map((profilesQuery.data ?? []).map((p) => [p.id, p.full_name]))

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-xl font-semibold">Configurações</h1>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Equipe</h2>
            {isTenantAdmin && (
              <button
                onClick={() => setShowInvite(true)}
                className="rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 text-sm font-medium text-bg"
              >
                + Convidar
              </button>
            )}
          </div>

          {membershipsQuery.isLoading && <p className="text-text-dim">Carregando…</p>}

          <ul className="flex flex-col gap-2">
            {(membershipsQuery.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-sm text-text">
                    {m.status === 'invited' ? m.invited_email : nameByUserId.get(m.user_id) || '—'}
                  </p>
                  <p className="text-xs text-text-faint">{ROLE_LABEL[m.role]}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[m.status]}`}>
                  {STATUS_LABEL[m.status]}
                </span>
              </li>
            ))}
            {!membershipsQuery.isLoading && (membershipsQuery.data ?? []).length === 0 && (
              <li className="text-sm text-text-dim">Nenhum membro ainda.</li>
            )}
          </ul>
        </section>

        {isTenantAdmin && (
          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold">Marca</h2>
            <p className="mt-1 text-sm text-text-dim">
              Cor de destaque e logo aplicados nas páginas desse tenant.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                brandingMutation.mutate()
              }}
              className="mt-4 flex max-w-sm flex-col gap-4"
            >
              <label className="flex flex-col gap-1.5 text-sm text-text-dim">
                Cor primária
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-20 rounded-lg border border-border bg-surface-2"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm text-text-dim">
                URL do logo
                <input
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://…"
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
                />
              </label>

              {brandingError && <p className="text-sm text-magenta">{brandingError}</p>}

              <button
                type="submit"
                disabled={brandingMutation.isPending}
                className="self-start rounded-full bg-gradient-to-r from-violet to-cyan px-4 py-2 text-sm font-medium text-bg disabled:opacity-60"
              >
                {brandingMutation.isPending ? 'Salvando…' : 'Salvar marca'}
              </button>
            </form>
          </section>
        )}
      </div>

      {showInvite && <InviteMemberDialog tenantId={tenantId} onClose={() => setShowInvite(false)} />}
    </TenantSidebarLayout>
  )
}
