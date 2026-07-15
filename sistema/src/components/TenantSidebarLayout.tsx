import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCompanyBranding } from '../hooks/useCompanyBranding'
import { brandingStyleFor } from '../lib/branding'

function navItems(tenantId: string) {
  return [
    { to: `/visao-geral/${tenantId}`, label: 'Visão Geral', code: '01' },
    { to: `/crm/${tenantId}`, label: 'CRM', code: '02' },
    { to: `/prospeccao/${tenantId}`, label: 'Prospecção', code: '03' },
    { to: `/financeiro/${tenantId}`, label: 'Financeiro', code: '04' },
    { to: `/hub/${tenantId}`, label: 'Hub', code: '05' },
    { to: `/configuracoes/${tenantId}`, label: 'Configurações', code: '06' },
  ]
}

export function TenantSidebarLayout({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { user, signOut } = useAuth()
  const brandingQuery = useCompanyBranding(tenantId)
  const name = brandingQuery.data?.name ?? 'BK Solutions'
  const logoUrl = brandingQuery.data?.branding_json.logo_url

  return (
    <div className="app-shell flex min-h-screen bg-bg text-text max-md:flex-col" style={brandingStyleFor(brandingQuery.data?.branding_json)}>
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-bg-alt/95 max-md:w-full max-md:border-b max-md:border-r-0">
        <Link to={`/visao-geral/${tenantId}`} className="flex items-center gap-3 border-b border-border px-5 py-6">
          {logoUrl ? <img src={logoUrl} alt="" className="h-9 w-9 rounded-sm object-cover" /> : <span className="brand-glow grid h-9 w-9 place-items-center bg-violet font-display text-sm font-bold text-bg">BK</span>}
          <span className="min-w-0"><span className="block truncate font-display text-base font-semibold">{name}</span><span className="eyebrow mt-1 block text-[9px]">growth system</span></span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-5 max-md:flex-row max-md:overflow-x-auto max-md:py-3">
          {navItems(tenantId).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `group flex items-center gap-3 whitespace-nowrap border-l-2 px-3 py-2.5 text-sm transition-colors ${isActive ? 'border-violet bg-violet/8 text-text' : 'border-transparent text-text-dim hover:border-text-faint hover:bg-surface hover:text-text'}`}>
              <span className="font-mono text-[10px] text-text-faint group-hover:text-violet">{item.code}</span>{item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-4 max-md:flex max-md:items-center max-md:gap-1 max-md:py-2">
          <p className="truncate px-3 pb-2 font-mono text-[10px] text-text-faint max-md:hidden">{user?.email}</p>
          <Link to="/empresas" className="block whitespace-nowrap px-3 py-2 text-sm text-text-dim hover:bg-surface hover:text-text">Trocar empresa</Link>
          <button onClick={() => signOut()} className="block whitespace-nowrap px-3 py-2 text-left text-sm text-text-dim hover:bg-surface hover:text-text">Sair</button>
        </div>
      </aside>
      <main className="app-main flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  )
}
