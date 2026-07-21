import type { ReactNode, SVGProps } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCompanyBranding } from '../hooks/useCompanyBranding'
import { brandingStyleFor } from '../lib/branding'
import { ThemeToggle } from './ThemeToggle'

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props} />
}

const NAV_ICONS = {
  overview: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>,
  crm: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="9" cy="7" r="3" /><path d="M3 21v-1a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v1" /><circle cx="18" cy="8" r="2.3" /><path d="M21 21v-.7a4 4 0 0 0-3-3.9" /></Icon>,
  prospeccao: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Icon>,
  disparos: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M3 11 20 3l-7 17-2.5-7.5L3 11Z" /><path d="M10.5 12.5 20 3" /></Icon>,
  financeiro: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></Icon>,
  hub: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="m7.8 7.6 3 8.6M16.2 7.6l-3 8.6" /></Icon>,
  config: (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.4a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9c.5.4 1.1.8 1.7 1L11 21h4l.4-2.4c.6-.2 1.2-.6 1.7-1l2.3.9 2-3.4-2-1.5Z" /></Icon>,
}

function navItems(tenantId: string) {
  return [
    { to: `/visao-geral/${tenantId}`, label: 'Visão Geral', icon: NAV_ICONS.overview },
    { to: `/crm/${tenantId}`, label: 'CRM', icon: NAV_ICONS.crm },
    { to: `/prospeccao/${tenantId}`, label: 'Prospecção', icon: NAV_ICONS.prospeccao },
    { to: `/disparos/${tenantId}`, label: 'Disparos', icon: NAV_ICONS.disparos },
    { to: `/financeiro/${tenantId}`, label: 'Financeiro', icon: NAV_ICONS.financeiro },
    { to: `/hub/${tenantId}`, label: 'Hub', icon: NAV_ICONS.hub },
    { to: `/configuracoes/${tenantId}`, label: 'Configurações', icon: NAV_ICONS.config },
  ]
}

export function TenantSidebarLayout({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { user, signOut } = useAuth()
  const brandingQuery = useCompanyBranding(tenantId)
  const name = brandingQuery.data?.name ?? 'BK Solutions'
  const logoUrl = brandingQuery.data?.branding_json.logo_url

  return (
    <div className="app-shell flex min-h-screen bg-bg text-text max-md:flex-col" style={brandingStyleFor(brandingQuery.data?.branding_json)}>
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar max-md:w-full max-md:border-b max-md:border-r-0">
        <Link to={`/visao-geral/${tenantId}`} className="m-3 flex items-center gap-3 rounded-xl bg-sidebar-surface px-3 py-3">
          {logoUrl ? <img src={logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="brand-glow grid h-9 w-9 place-items-center rounded-lg bg-violet font-display text-sm font-bold text-bg">BK</span>}
          <span className="min-w-0"><span className="block truncate font-display text-sm font-semibold text-sidebar-fg">{name}</span><span className="mt-0.5 block text-xs text-sidebar-fg-faint">Painel de operação</span></span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2 max-md:flex-row max-md:overflow-x-auto max-md:py-3">
          {navItems(tenantId).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-violet/15 font-medium text-sidebar-fg' : 'text-sidebar-fg-dim hover:bg-sidebar-surface hover:text-sidebar-fg'}`}>
              {({ isActive }: { isActive: boolean }) => (
                <>
                  <item.icon className={isActive ? 'text-violet' : 'text-sidebar-fg-faint'} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3 max-md:flex max-md:items-center max-md:gap-1 max-md:border-t-0">
          <div className="flex items-center justify-between px-3 pb-2 max-md:p-0">
            <p className="truncate text-xs text-sidebar-fg-faint max-md:hidden">{user?.email}</p>
            <ThemeToggle className="text-sidebar-fg-faint hover:bg-sidebar-surface hover:text-sidebar-fg" />
          </div>
          <Link to="/empresas" className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm text-sidebar-fg-dim hover:bg-sidebar-surface hover:text-sidebar-fg">Trocar empresa</Link>
          <button onClick={() => signOut()} className="block whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-sidebar-fg-dim hover:bg-sidebar-surface hover:text-sidebar-fg">Sair</button>
        </div>
      </aside>
      <main className="app-main flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  )
}
