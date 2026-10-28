import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function validUrl(value: string | undefined) {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
  } catch {
    return false
  }
}

// Keep this signal before the SDK consumes and removes the recovery URL fragment.
export const recoveryRedirectDetected = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'

// This module is bundled for the browser. Never accept a server-side secret.
export const isSupabaseConfigured = Boolean(
  validUrl(url) && key?.startsWith('sb_publishable_'),
)

export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
