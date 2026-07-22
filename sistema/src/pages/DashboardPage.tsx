import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

type Company = {
  id: string
  name: string
  slug: string
  plan_tier: string
  status: string
}

export function DashboardPage() {
  const { user, isPlatformAdmin, signOut } = useAuth()

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name, slug, plan_tier, status')
      if (error) throw error
      return data as Company[]
    },
  })

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-display text-lg font-semibold">BK Solutions</span>
        <div className="flex items-center gap-4 text-sm text-text-dim">
          <span>{user?.email}</span>
          {isPlatformAdmin && (
            <>
              <span className="rounded-full bg-violet/15 px-2 py-0.5 text-xs text-violet">
                super admin
              </span>
              <Link to="/cerebro" className="hover:text-text">
                Cérebro
              </Link>
            </>
          )}
          <button onClick={() => signOut()} className="text-text-dim hover:text-text">
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-2xl font-bold text-text">Empresas</h1>
        <p className="mt-2 text-sm text-text-dim">
          Tenants visíveis pra esse usuário (via RLS + claims do JWT).
        </p>

        {isLoading && <p className="mt-6 text-text-dim">Carregando…</p>}

        <ul className="mt-6 flex flex-col gap-4">
          {companies?.map((company) => (
            <li key={company.id}>
              <Link
                to={`/visao-geral/${company.id}`}
                className="card card-hover flex items-center justify-between px-5 py-4 hover:border-violet/50"
              >
                <div>
                  <p className="font-medium">{company.name}</p>
                  <p className="text-xs text-text-faint">
                    {company.slug} · {company.plan_tier} · {company.status}
                  </p>
                </div>
                <span className="text-text-faint">→</span>
              </Link>
            </li>
          ))}
          {companies?.length === 0 && (
            <li className="text-sm text-text-dim">
              Nenhuma empresa vinculada a esse usuário ainda.
            </li>
          )}
        </ul>
      </main>
    </div>
  )
}
