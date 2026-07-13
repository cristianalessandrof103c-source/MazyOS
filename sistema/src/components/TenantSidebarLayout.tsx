import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCompanyBranding } from '../hooks/useCompanyBranding'
import { brandingStyleFor } from '../lib/branding'

function navItems(tenantId: string) {
  return [
    { to: `/visao-geral/${tenantId}`, label: 'Visão Geral' },
    { to: `/crm/${tenantId}`, label: 'CRM' },
    { to: `/prospeccao/${tenantId}`, label: 'Prospecção' },
    { to: `/financeiro/${tenantId}`, label: 'Financeiro' },
    { to: `/hub/${tenantId}`, label: 'Hub' },
    { to: `/configuracoes/${tenantId}`, label: 'Configurações' },
  ]
}

export function TenantSidebarLayout({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { user, signOut } = useAuth()
  const brandingQuery = useCompanyBranding(tenantId)
  const name = brandingQuery.data?.name ?? 'BK Solutions'
  const logoUrl = brandingQuery.data?.branding_json.logo_url

  return (
    <div
      className="flex min-h-screen bg-bg text-text"
      style={brandingStyleFor(brandingQuery.data?.branding_json)}
    >
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border bg-surface">
        <Link to={`/visao-geral/${tenantId}`} className="flex items-center gap-2 px-5 py-5">
          {logoUrl && <img src={logoUrl} alt="" className="h-6 w-6 rounded object-cover" />}
          <span className="font-display truncate text-base font-semibold">{name}</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {navItems(tenantId).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-violet/10 text-violet' : 'text-text-dim hover:bg-surface-2 hover:text-text'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-4">
          <p className="truncate px-3 pb-2 text-xs text-text-faint">{user?.email}</p>
          <Link
            to="/empresas"
            className="block rounded-lg px-3 py-2 text-sm text-text-dim hover:bg-surface-2 hover:text-text"
          >
            Trocar empresa
          </Link>
          <button
            onClick={() => signOut()}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-text-dim hover:bg-surface-2 hover:text-text"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
    </div>
  )
}
