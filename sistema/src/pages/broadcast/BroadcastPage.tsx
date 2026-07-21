import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { TenantSidebarLayout } from '../../components/TenantSidebarLayout'
import { ImportContactsDialog } from './ImportContactsDialog'
import { NewCampaignDialog } from './NewCampaignDialog'
import { CampaignCard } from './CampaignCard'
import type { BroadcastCampaign, BroadcastList } from '../../lib/broadcast-types'
import type { Membership } from '../../lib/crm-types'

export function BroadcastPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { user, isPlatformAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [newListName, setNewListName] = useState('')
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

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
  const isTenantAdmin = isPlatformAdmin || myMembershipQuery.data?.role === 'tenant_admin'

  const listsQuery = useQuery({
    queryKey: ['broadcast-lists', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_lists')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BroadcastList[]
    },
    enabled: Boolean(tenantId),
  })

  const lists = listsQuery.data ?? []
  const activeListId = selectedListId ?? lists[0]?.id ?? null

  const contactsCountQuery = useQuery({
    queryKey: ['broadcast-contacts-count', activeListId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('broadcast_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', activeListId)
      if (error) throw error
      return count ?? 0
    },
    enabled: Boolean(activeListId),
  })

  const createListMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_lists')
        .insert({ tenant_id: tenantId, name: newListName.trim() })
        .select()
        .single()
      if (error) throw error
      return data as BroadcastList
    },
    onSuccess: (list) => {
      setListError(null)
      setNewListName('')
      setSelectedListId(list.id)
      queryClient.invalidateQueries({ queryKey: ['broadcast-lists', tenantId] })
    },
    onError: (err: Error) => setListError(err.message),
  })

  const campaignsQuery = useQuery({
    queryKey: ['broadcast-campaigns', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broadcast_campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BroadcastCampaign[]
    },
    enabled: Boolean(tenantId),
    refetchInterval: (query) => {
      const campaigns = query.state.data as BroadcastCampaign[] | undefined
      return campaigns?.some((c) => c.status === 'sending') ? 5000 : false
    },
  })

  function handleCreateList(e: FormEvent) {
    e.preventDefault()
    if (!newListName.trim()) return
    createListMutation.mutate()
  }

  if (!tenantId) return null

  return (
    <TenantSidebarLayout tenantId={tenantId}>
      <header>
        <p className="eyebrow">Disparos</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-text">Disparo em massa via WhatsApp</h1>
        <p className="mt-2 text-sm text-text-dim">
          Importe uma lista de contatos via CSV e dispare uma campanha usando um Template aprovado pela Meta.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-section font-semibold text-text">Listas de contatos</h2>

        {isTenantAdmin && (
          <form onSubmit={handleCreateList} className="mt-3 flex items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm text-text-dim">
              Nova lista
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="Clientes de julho"
                className="w-64 rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
              />
            </label>
            <button
              type="submit"
              disabled={createListMutation.isPending || !newListName.trim()}
              className="btn-primary px-4 py-2 text-sm"
            >
              {createListMutation.isPending ? 'Criando…' : '+ Criar lista'}
            </button>
          </form>
        )}
        {listError && <p className="mt-2 text-sm text-magenta">{listError}</p>}

        {listsQuery.isLoading && <p className="mt-3 text-text-dim">Carregando…</p>}

        {!listsQuery.isLoading && lists.length === 0 && (
          <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
            Nenhuma lista ainda. Crie uma lista acima pra começar a importar contatos.
          </p>
        )}

        {lists.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => setSelectedListId(list.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  activeListId === list.id ? 'bg-violet/15 text-violet' : 'border border-border text-text-dim hover:border-violet'
                }`}
              >
                {list.name}
              </button>
            ))}
          </div>
        )}

        {activeListId && (
          <div className="card mt-4 flex items-center justify-between p-7">
            <div>
              <p className="text-sm text-text">{lists.find((l) => l.id === activeListId)?.name}</p>
              <p className="text-xs text-text-faint">
                {contactsCountQuery.isLoading ? 'Contando…' : `${contactsCountQuery.data ?? 0} contatos`}
              </p>
            </div>
            {isTenantAdmin && (
              <button
                onClick={() => setShowImport(true)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-dim hover:border-violet hover:text-text"
              >
                Importar CSV
              </button>
            )}
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-section font-semibold text-text">Campanhas</h2>
          {isTenantAdmin && lists.length > 0 && (
            <button onClick={() => setShowNewCampaign(true)} className="btn-primary px-4 py-2 text-sm">
              + Nova campanha
            </button>
          )}
        </div>

        {campaignsQuery.isLoading && <p className="text-text-dim">Carregando…</p>}

        {!campaignsQuery.isLoading && (campaignsQuery.data ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
            Nenhuma campanha ainda. Crie uma lista, importe contatos e crie uma campanha pra começar.
          </p>
        )}

        <ul className="flex flex-col gap-4">
          {(campaignsQuery.data ?? []).map((campaign) => (
            <CampaignCard key={campaign.id} tenantId={tenantId} campaign={campaign} isTenantAdmin={isTenantAdmin} />
          ))}
        </ul>
      </section>

      {showImport && activeListId && (
        <ImportContactsDialog tenantId={tenantId} listId={activeListId} onClose={() => setShowImport(false)} />
      )}
      {showNewCampaign && <NewCampaignDialog tenantId={tenantId} lists={lists} onClose={() => setShowNewCampaign(false)} />}
    </TenantSidebarLayout>
  )
}
