import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { BrandingJson } from '../lib/branding'

export function useCompanyBranding(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['company-branding', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('name, branding_json')
        .eq('id', tenantId)
        .single()
      if (error) throw error
      return data as { name: string; branding_json: BrandingJson }
    },
    enabled: Boolean(tenantId),
  })
}
