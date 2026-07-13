import type { CSSProperties } from 'react'

export type BrandingJson = {
  primary_color?: string
  logo_url?: string
}

// Os tokens de cor em index.css já são CSS custom properties (@theme do Tailwind v4) —
// sobrescrever --color-violet no container raiz aplica a cor em cascata pras classes
// text-violet/bg-violet/etc. sem precisar rebuildar o Tailwind por tenant.
export function brandingStyleFor(branding?: BrandingJson | null): CSSProperties {
  if (!branding?.primary_color) return {}
  return { '--color-violet': branding.primary_color } as CSSProperties
}
