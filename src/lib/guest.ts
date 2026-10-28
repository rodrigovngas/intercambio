import { rpc } from './api'
import type { Assignment } from './api'

export type GuestEvent = {
  id: string
  title: string
  event_date: string
  budget: string
  gift_type: string
  status: 'draft' | 'drawn' | 'archived'
  drawn_at: string | null
}

export type GuestPreview = Omit<GuestEvent, 'id'> & {
  event_id: string
  participant_id: string
  participant_name: string
  has_pin: boolean
}

export type GuestProfile = {
  id: string
  name: string
  is_child: boolean
  wishes: string[]
  extra: string
}

export type GuestProfileBundle = {
  event: GuestEvent
  participant_id: string
  expires_at: string
  profiles: GuestProfile[]
}

export type GuestSession = {
  session_token: string
  expires_at: string
}

export type GuestPinResponse =
  | ({ ok: true } & GuestSession)
  | { ok: false; error: string; retry_after_seconds?: number }

const sessionKey = (invitation: string) => `intercambio_guest_${invitation}`

export function validGuestSession(value: unknown): value is GuestSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GuestSession>
  return typeof candidate.session_token === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.session_token)
    && typeof candidate.expires_at === 'string'
    && Number.isFinite(Date.parse(candidate.expires_at))
    && Date.parse(candidate.expires_at) > Date.now()
}

// Only the short-lived guest session lives in this tab. A PIN never goes here.
export function readGuestSession(invitation: string): GuestSession | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(sessionKey(invitation)) ?? 'null')
    if (validGuestSession(saved)) return saved
    sessionStorage.removeItem(sessionKey(invitation))
  } catch {
    // Storage may be blocked; guests can still enter using their PIN.
  }
  return null
}

export function rememberGuestSession(invitation: string, session: GuestSession) {
  if (!validGuestSession(session)) throw new Error('El acceso recibido no es válido. Inténtalo de nuevo.')
  try {
    sessionStorage.setItem(sessionKey(invitation), JSON.stringify({
      session_token: session.session_token,
      expires_at: session.expires_at,
    }))
  } catch {
    // The current in-memory session remains usable without persistent storage.
  }
}

export function forgetGuestSession(invitation: string) {
  try {
    sessionStorage.removeItem(sessionKey(invitation))
  } catch {
    // No storage means there is no saved session to remove.
  }
}

export function isGuestSessionError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '28000')
}

export const guestApi = {
  preview: (token: string) => rpc<GuestPreview>('guest_preview', { p_token: token }),
  unlock: (token: string, pin: string, register: boolean) => rpc<GuestPinResponse>(
    register ? 'guest_register' : 'guest_login',
    { p_token: token, p_pin: pin },
  ),
  profile: (session: string) => rpc<GuestProfileBundle>('guest_profile', { p_session_token: session }),
  assignment: (session: string, participantId: string) => rpc<Assignment>('guest_assignment', {
    p_session_token: session,
    p_participant_id: participantId,
  }),
  saveWishes: (session: string, participantId: string, wishes: string[], extra: string) => rpc<void>(
    'guest_save_wishes',
    { p_session_token: session, p_participant_id: participantId, p_wishes: wishes, p_extra: extra },
  ),
  logout: (session: string) => rpc<void>('guest_logout', { p_session_token: session }),
}
