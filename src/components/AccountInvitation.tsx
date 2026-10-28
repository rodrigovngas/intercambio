import {useEffect, useRef, useState} from 'react'
import {ArrowLeft, CalendarDays, Gift, LoaderCircle, LogOut, RefreshCw} from 'lucide-react'
import {Auth} from './Auth'
import {formatDate, friendlyError, rpc} from '../lib/api'
import type {InvitePreview} from '../lib/api'

export type AccountInvitationPreview = InvitePreview

type Props = {
  token: string
  preview: AccountInvitationPreview
  signedIn: boolean
  accountLoading: boolean
  accountAllowed: boolean
  accountDeleted: boolean
  accountError: string
  onRetryAccount: () => void
  onSignOut: () => void | Promise<void>
  onJoined: (eventId: string) => void
  onExit: () => void
}

export function AccountInvitation({token, preview, signedIn, accountLoading, accountAllowed, accountDeleted, accountError, onRetryAccount, onSignOut, onJoined, onExit}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])

  async function join() {
    if (!accountAllowed || busy) return
    setBusy(true); setError('')
    try {
      await rpc('claim_participant', {p_token: token})
      if (mounted.current) onJoined(preview.event_id)
    } catch (caught) {
      if (mounted.current) setError(friendlyError(caught))
    } finally {if (mounted.current) setBusy(false)}
  }

  const unavailable = Boolean(preview.claimed && !preview.is_mine)
  return <section className="screen pt-4">
    <button className="btn-text -ml-3 mb-6" disabled={busy} onClick={onExit}><ArrowLeft size={17}/>Inicio</button>
    <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800"><Gift size={27} strokeWidth={1.5}/></div>
    <h1 className="heading break-words">{preview.title}</h1>
    <p className="subheading">Invitación para {preview.participant_name}</p>
    <div className="mt-4 flex flex-wrap justify-center gap-2"><span className="pill"><CalendarDays size={13}/>{formatDate(preview.event_date)}</span><span className="pill">{preview.budget}</span>{preview.gift_type && <span className="pill"><Gift size={13}/>{preview.gift_type}</span>}</div>
    {accountLoading ? <div role="status" aria-label="Verificando tu cuenta" className="flex justify-center py-12"><LoaderCircle className="animate-spin text-gray-400"/></div> : !signedIn ? <div className="mt-7"><p className="mb-5 text-center text-sm leading-relaxed text-gray-500 dark:text-gray-400">Para participar en este evento necesitas una cuenta. Inicia sesión o regístrate para continuar.</p><Auth onDone={() => {}}/></div> : !accountAllowed ? <div className="mt-7">
      <p role={accountError ? 'alert' : 'status'} className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{accountError || (accountDeleted ? 'Tu cuenta de Intercambio fue eliminada. No se puede recuperar el acceso automáticamente al iniciar sesión.' : 'No pudimos habilitar tu cuenta. Confirma tu correo para continuar.')}</p>
      {accountError && <button className="btn-secondary mt-5" onClick={onRetryAccount}><RefreshCw size={16}/>Reintentar</button>}
      <button className="btn-text mx-auto mt-4" onClick={() => void onSignOut()}><LogOut size={16}/>Cerrar sesión</button>
    </div> : <div className="mt-7">
      <p className="text-center text-sm leading-relaxed text-gray-500 dark:text-gray-400">{unavailable ? 'Esta invitación ya está vinculada a otra cuenta. Pide al organizador tu enlace personal.' : preview.is_mine ? 'Esta invitación ya está vinculada a tu cuenta.' : 'Vincula esta invitación a tu cuenta para consultar tu resultado y guardar tus preferencias.'}</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button className="btn-primary mt-6" disabled={busy || unavailable} onClick={() => void join()}>{busy && <LoaderCircle size={18} className="animate-spin"/>}{preview.is_mine ? 'Ir a mi intercambio' : 'Unirme al intercambio'}</button>
      {unavailable && <button className="btn-text mx-auto mt-3" disabled={busy} onClick={() => void onSignOut()}><LogOut size={16}/>Usar otra cuenta</button>}
    </div>}
  </section>
}
