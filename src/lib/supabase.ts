import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function isAllowedSupabaseUrl(value: string | undefined) {
  if (!value) return false
  try {
    const parsedUrl = new URL(value)
    return (
      parsedUrl.protocol === 'https:' ||
      (parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname))
    )
  } catch {
    return false
  }
}

// Keep this signal before the SDK consumes and removes the recovery URL fragment.
export const recoveryRedirectDetected =
  new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'

// This module is bundled for the browser. Never accept a server-side secret.
export const isSupabaseConfigured = Boolean(
  isAllowedSupabaseUrl(supabaseUrl) && publishableKey?.startsWith('sb_publishable_'),
)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
