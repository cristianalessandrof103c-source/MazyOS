import type { MembershipRole } from './crm-types'

export const ROLE_LABEL: Record<MembershipRole, string> = {
  tenant_admin: 'Admin',
  tenant_manager: 'Gerente',
  tenant_agent: 'Agente',
  tenant_viewer: 'Visualizador',
}
