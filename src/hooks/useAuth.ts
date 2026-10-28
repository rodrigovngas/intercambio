import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { recoveryRedirectDetected, supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [recovering, setRecovering] = useState(recoveryRedirectDetected)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let mounted = true
    let receivedAuthEvent = false

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      receivedAuthEvent = true
      setUser(session?.user ?? null)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
    })

    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return
      if (!receivedAuthEvent) setUser(data.session?.user ?? null)
      if (sessionError) setError('No pudimos recuperar tu sesión. Intenta iniciar sesión de nuevo.')
      setLoading(false)
    }).catch(() => {
      if (!mounted) return
      setError('No pudimos conectar con el servicio de cuentas.')
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const clearRecovery = useCallback(() => setRecovering(false), [])
  const signOut = useCallback(async () => {
    setError(null)
    if (!supabase) return true
    try {
      // This project also hosts Stocka. Signing out here must not revoke other sessions.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      setUser(null)
      setRecovering(false)
      return true
    } catch {
      setError('No pudimos cerrar tu sesión. Inténtalo otra vez.')
      return false
    }
  }, [])

  return { user, loading, recovering, clearRecovery, signOut, error }
}
