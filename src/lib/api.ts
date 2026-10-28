import { supabase } from './supabase'
export type ExchangeEvent = {
  id: string; owner_id: string; title: string; event_date: string; budget: string; gift_type: string;
  status: 'draft' | 'drawn' | 'archived'; invite_code: string; drawn_at: string | null; created_at: string;
}
export type Participant = {
  id: string; event_id: string; name: string; is_child: boolean; user_id: string | null;
  guardian_id: string | null; wishes: string[]; extra: string;
}
export type DraftParticipant = { name: string; is_child: boolean; guardian_index?: number }
export type Invitation = { participant_id: string; name: string; token: string | null; claimed: boolean; revealed?: boolean }
export type InvitePreview = { event_id: string; title: string; event_date: string; budget: string; gift_type: string; participant_id: string; participant_name: string; claimed: boolean; is_mine: boolean | null }
export type Assignment = { participant_id: string; target_id: string; target_name: string; wishes: string[]; extra: string }
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('No se pudo conectar con Intercambio. Inténtalo más tarde.')
  const { data, error } = await supabase.rpc(`intercambio_${name}`, args)
  if (error) throw error
  return data as T
}
export async function listEvents() {
  if (!supabase) return []
  const { data, error } = await supabase.from('intercambio_events').select('*').order('created_at', {ascending:false})
  if (error) throw error
  return data as ExchangeEvent[]
}
export async function loadEvent(id: string, legacy = false) {
  if (!supabase) throw new Error('No hay conexión con el servicio.')
  const { data, error } = await supabase.from('intercambio_events').select('*').eq(legacy ? 'legacy_id' : 'id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No encontramos este evento en tu cuenta. Pide una invitación al organizador.')
  const {data:participants, error:pe} = await supabase.from('intercambio_participants').select('*').eq('event_id',data.id).order('created_at').order('id')
  if (pe) throw pe
  return {event:data as ExchangeEvent, participants:participants as Participant[]}
}
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
  if (/fetch|network|load failed/i.test(raw)) return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
  if (/JWT|session|not authenticated|authentication required/i.test(raw)) return 'Inicia sesión de nuevo para continuar.'
  if (/permission|denied|not authorized/i.test(raw)) return 'Tu cuenta no tiene permiso para realizar esta acción.'
  if (/relation.*does not exist|function.*not.*found|schema cache/i.test(raw)) return 'El servicio se está preparando. Inténtalo más tarde.'
  return raw || 'Algo salió mal. Inténtalo de nuevo.'
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`))
}
export function invitationUrl(token: string) { return `${window.location.origin}/#invite=${encodeURIComponent(token)}` }
export function eventUrl(id: string) { return `${window.location.origin}/?event=${encodeURIComponent(id)}` }
export function validParticipants(items: DraftParticipant[]) {
  if (items.length < 2) return 'Agrega al menos dos participantes.'
  if (items.length > 100) return 'El límite es de 100 participantes por evento.'
  if (items.some(p=>!p.name.trim() || p.name.trim().length > 80)) return 'Cada nombre debe tener entre 1 y 80 caracteres.'
  if (new Set(items.map(p=>p.name.trim().toLocaleLowerCase('es-MX'))).size !== items.length) return 'Usa nombres diferentes para distinguir a cada participante.'
  if (items.some(p=>p.is_child && (p.guardian_index === undefined || !items[p.guardian_index] || items[p.guardian_index].is_child))) return 'Asigna un adulto responsable a cada dependiente.'
  return null
}
