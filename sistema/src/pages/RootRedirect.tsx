import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Company = { id: string; name: string; slug: string; plan_tier: string; status: string }

export function RootRedirect() {
  const { user, signOut } = useAuth()
  const [acceptChecked, setAcceptChecked] = useState(false)

  // Convite aceito (Fase 7): "/" é o único ponto por onde todo login passa antes de decidir
  // rota, então é aqui (não em DashboardPage) que a aceitação precisa rodar — senão quem tem
  // só um tenant e cai direto na Visão Geral nunca aceitaria o convite pendente.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('memberships')
      .update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('status', 'invited')
      .select('id')
      .then(async ({ data }) => {
        if (data && data.length > 0) {
          await supabase.auth.refreshSession()
        }
        if (!cancelled) setAcceptChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name, slug, plan_tier, status')
      if (error) throw error
      return data as Company[]
    },
    enabled: acceptChecked,
  })

  if (!acceptChecked || companiesQuery.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-text-dim">Carregando…</div>
  }

  const companies = companiesQuery.data ?? []

  if (companies.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text-dim">
        <p>Nenhuma empresa vinculada a esse usuário ainda.</p>
        <button onClick={() => signOut()} className="text-sm text-text-dim underline hover:text-text">
          Sair
        </button>
      </div>
    )
  }

  if (companies.length === 1) {
    return <Navigate to={`/visao-geral/${companies[0].id}`} replace />
  }

  return <Navigate to="/empresas" replace />
}
