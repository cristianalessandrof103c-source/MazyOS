import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

type InsightStatus = 'draft' | 'approved' | 'archived'

type Insight = {
  id: string
  category: 'objection_handling' | 'pricing' | 'closing_technique' | 'faq'
  insight_text: string
  source_conversation_ids: string[]
  status: InsightStatus
  created_at: string
}

const CATEGORY_LABEL: Record<Insight['category'], string> = {
  objection_handling: 'Objeção',
  pricing: 'Preço',
  closing_technique: 'Fechamento',
  faq: 'FAQ',
}

const TABS: { status: InsightStatus; label: string }[] = [
  { status: 'draft', label: 'Rascunhos' },
  { status: 'approved', label: 'Aprovados' },
  { status: 'archived', label: 'Arquivados' },
]

export function CerebroPage() {
  const { isPlatformAdmin, user, signOut } = useAuth()
  const [tab, setTab] = useState<InsightStatus>('draft')
  const queryClient = useQueryClient()

  const insightsQuery = useQuery({
    queryKey: ['knowledge-base-insights', tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_base_insights')
        .select('id, category, insight_text, source_conversation_ids, status, created_at')
        .eq('status', tab)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Insight[]
    },
    enabled: isPlatformAdmin,
  })

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'archived' }) => {
      const { error } = await supabase
        .from('knowledge_base_insights')
        .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-base-insights'] }),
  })

  if (!isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <p className="text-text-dim">Acesso restrito ao time BK Solutions.</p>
      </div>
    )
  }

  const insights = insightsQuery.data ?? []

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="font-display text-lg font-semibold">
            BK Solutions
          </Link>
          <span className="text-text-faint">/</span>
          <span className="text-sm text-text-dim">Cérebro</span>
        </div>
        <button onClick={() => signOut()} className="text-sm text-text-dim hover:text-text">
          Sair
        </button>
      </header>

      <main className="px-6 py-8">
        <h1 className="font-display text-xl font-semibold">Cérebro coletivo</h1>
        <p className="mt-1 text-sm text-text-dim">
          Insights extraídos de conversas encerradas, compartilhados entre todos os tenants. Só
          entram no agente depois de aprovados aqui.
        </p>

        <div className="mt-6 flex gap-2 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.status}
              onClick={() => setTab(t.status)}
              className={`px-3 py-2 text-sm ${
                tab === t.status
                  ? 'border-b-2 border-violet text-text'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {insightsQuery.isLoading && <p className="mt-6 text-text-dim">Carregando…</p>}

        <ul className="mt-6 flex flex-col gap-3">
          {insights.map((insight) => (
            <li key={insight.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="rounded-full bg-violet/15 px-2 py-0.5 text-xs text-violet">
                    {CATEGORY_LABEL[insight.category]}
                  </span>
                  <p className="mt-2 text-sm text-text">{insight.insight_text}</p>
                  <p className="mt-2 text-xs text-text-faint">
                    {new Date(insight.created_at).toLocaleDateString('pt-BR')} · originado de{' '}
                    {insight.source_conversation_ids.length} conversa(s)
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  {tab === 'draft' && (
                    <>
                      <button
                        onClick={() => reviewMutation.mutate({ id: insight.id, status: 'approved' })}
                        className="rounded-full border border-violet/40 px-3 py-1 text-xs text-violet hover:bg-violet/10"
                      >
                        Aprovar
                      </button>
                      <button
                        onClick={() => reviewMutation.mutate({ id: insight.id, status: 'archived' })}
                        className="rounded-full border border-border px-3 py-1 text-xs text-text-dim hover:text-text"
                      >
                        Arquivar
                      </button>
                    </>
                  )}
                  {tab === 'approved' && (
                    <button
                      onClick={() => reviewMutation.mutate({ id: insight.id, status: 'archived' })}
                      className="rounded-full border border-border px-3 py-1 text-xs text-text-dim hover:text-text"
                    >
                      Arquivar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {!insightsQuery.isLoading && insights.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
              Nenhum insight {tab === 'draft' ? 'aguardando revisão' : tab === 'approved' ? 'aprovado' : 'arquivado'} ainda.
            </li>
          )}
        </ul>
      </main>
    </div>
  )
}
