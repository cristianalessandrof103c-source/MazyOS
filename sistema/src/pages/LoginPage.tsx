import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Link de convite/recuperação de senha do Supabase já autentica ao carregar a página (a
// sessão vem no hash da URL) — sem isso o usuário cairia direto no dashboard com uma senha
// aleatória que nunca viu. Lido uma vez, antes do Supabase limpar o hash.
function isSettingPasswordFlow(): boolean {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const type = params.get('type')
  return type === 'invite' || type === 'recovery'
}

// Logo oficial ainda não foi integrada (sistema/public/logo-bk-solutions.png) — até lá,
// cai automaticamente pro wordmark em texto via onError, sem quebrar a tela.
function LoginBrand() {
  const [imgFailed, setImgFailed] = useState(false)
  if (imgFailed) {
    return (
      <h1 className="font-display bg-gradient-to-r from-violet to-cyan bg-clip-text text-2xl font-semibold text-transparent">
        BK Solutions
      </h1>
    )
  }
  return (
    <img
      src="/logo-bk-solutions.png"
      alt="BK Solutions"
      className="h-14 w-auto"
      onError={() => setImgFailed(true)}
    />
  )
}

export function LoginPage() {
  const { session, signInWithPassword } = useAuth()
  const navigate = useNavigate()
  const [settingPassword] = useState(isSettingPasswordFlow)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session && !settingPassword) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signInWithPassword(email, password)
    if (error) setError(error)
    setSubmitting(false)
  }

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate('/', { replace: true })
  }

  if (session && settingPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <form onSubmit={handleSetPassword} className="card w-full max-w-sm p-8">
          <LoginBrand />
          <p className="mt-3 text-sm text-text-dim">Defina sua senha pra continuar</p>

          <div className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-text-dim">
              Nova senha
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
                autoComplete="new-password"
              />
            </label>

            {error && <p className="text-sm text-magenta">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary mt-2 px-4 py-2.5">
              {submitting ? 'Salvando…' : 'Definir senha e entrar'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8">
        <LoginBrand />
        <p className="mt-3 text-sm text-text-dim">Entrar no sistema</p>

        <div className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
              autoComplete="email"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-text-dim">
            Senha
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-text outline-none focus:border-violet"
              autoComplete="current-password"
            />
          </label>

          {error && <p className="text-sm text-magenta">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary mt-2 px-4 py-2.5">
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  )
}
