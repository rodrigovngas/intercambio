import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, Eye, EyeOff, Gift, LoaderCircle, LockKeyhole, LogOut, RefreshCw } from 'lucide-react'
import confetti from 'canvas-confetti'
import { formatDate, friendlyError } from '../lib/api'
import type { Assignment } from '../lib/api'
import {
  forgetGuestSession,
  guestApi,
  isGuestSessionError,
  readGuestSession,
  rememberGuestSession,
  validGuestSession,
} from '../lib/guest'
import type { GuestPreview, GuestProfileBundle, GuestSession } from '../lib/guest'

type GuestExchangeProps = {
  token: string
  onExit: () => void
  onToast: (message: string) => void
}

const expiredMessage = 'Tu sesión de invitado terminó. Vuelve a entrar para consultar tu intercambio.'

export function GuestExchange(props: GuestExchangeProps) {
  // Changing invitations always discards the previous participant's visible state.
  return <GuestExperience key={props.token} {...props} />
}

function GuestExperience({ token, onExit, onToast }: GuestExchangeProps) {
  const [preview, setPreview] = useState<GuestPreview | null>(null)
  const [session, setSession] = useState<GuestSession | null>(null)
  const [bundle, setBundle] = useState<GuestProfileBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [bootError, setBootError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [active, setActive] = useState('')
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [wishes, setWishes] = useState(['', '', ''])
  const [extra, setExtra] = useState('')
  const mounted = useRef(true)
  const requestId = useRef(0)
  const pinInput = useRef<HTMLInputElement>(null)
  const prefix = useId()
  const profile = bundle?.profiles.find(person => person.id === active)
    ?? bundle?.profiles.find(person => person.id === bundle.participant_id)
    ?? bundle?.profiles[0]
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBootError(false)
    setError('')
    const saved = readGuestSession(token)
    async function load() {
      const [invitation, restored] = await Promise.allSettled([
        guestApi.preview(token),
        saved ? guestApi.profile(saved.session_token) : Promise.resolve(null),
      ])
      if (cancelled) return
      if (invitation.status === 'fulfilled') setPreview(invitation.value)
      if (saved && restored.status === 'fulfilled' && restored.value) {
        setSession(saved)
        setBundle(restored.value)
        setActive(restored.value.participant_id)
      } else if (saved && restored.status === 'rejected') {
        if (isGuestSessionError(restored.reason)) {
          forgetGuestSession(token)
          setSession(null)
          setBundle(null)
          setError(expiredMessage)
        } else {
          setBootError(true)
          setError(friendlyError(restored.reason))
        }
      }
      if (invitation.status === 'rejected' && !(restored.status === 'fulfilled' && restored.value)) {
        setBootError(true)
        setError(friendlyError(invitation.reason))
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [token, reload])

  useEffect(() => {
    setAssignment(null)
    if (!profile) return
    setWishes([0, 1, 2].map(index => profile.wishes?.[index] ?? ''))
    setExtra(profile.extra ?? '')
  }, [profile?.id])

  useEffect(() => {
    if (!session) return
    const timeout = setTimeout(sessionEnded, Math.max(0, Date.parse(session.expires_at) - Date.now()))
    return () => clearTimeout(timeout)
  }, [session, token])

  useEffect(() => {
    if (lockedUntil <= Date.now()) return
    const timer = setInterval(() => {
      const timestamp = Date.now()
      setNow(timestamp)
      if (timestamp >= lockedUntil) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  function sessionEnded() {
    requestId.current += 1
    forgetGuestSession(token)
    setSession(null)
    setBundle(null)
    setAssignment(null)
    setPin('')
    setConfirmation('')
    setBusy(false)
    setBootError(false)
    setError(expiredMessage)
    // A reset revokes sessions and removes the old PIN. Refresh this flag so the
    // same open invitation can offer PIN creation without requiring a page reload.
    const current = requestId.current
    void guestApi.preview(token).then(data => {
      if (mounted.current && current === requestId.current) setPreview(data)
    }).catch(() => {})
  }

  async function perform<T>(operation: () => Promise<T>, success: (value: T) => void) {
    const current = ++requestId.current
    setBusy(true)
    setError('')
    try {
      const value = await operation()
      if (mounted.current && current === requestId.current) success(value)
    } catch (caught) {
      if (!mounted.current || current !== requestId.current) return
      if (isGuestSessionError(caught)) sessionEnded()
      else setError(friendlyError(caught))
    } finally {
      if (mounted.current && current === requestId.current) setBusy(false)
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || busy || remaining > 0) return
    setError('')
    if (!/^\d{6}$/.test(pin)) { setError('Tu NIP debe tener exactamente seis números.'); return }
    if (!preview.has_pin && pin !== confirmation) { setError('Los NIP no coinciden. Vuelve a confirmarlo.'); return }
    const current = ++requestId.current
    setBusy(true)
    try {
      const response = await guestApi.unlock(token, pin, !preview.has_pin)
      if (!mounted.current || current !== requestId.current) return
      setPin('')
      setConfirmation('')
      if (!response.ok) {
        setError(response.error)
        if (/ya tiene un NIP|Primero crea tu NIP/i.test(response.error)) {
          try {
            const refreshed = await guestApi.preview(token)
            if (!mounted.current || current !== requestId.current) return
            setPreview(refreshed)
            if (!refreshed.has_pin) setLockedUntil(0)
          } catch {
            if (mounted.current && current === requestId.current) {
              setPreview({ ...preview, has_pin: !/Primero crea tu NIP/i.test(response.error) })
            }
          }
        }
        if (response.retry_after_seconds && response.retry_after_seconds > 0) {
          setNow(Date.now())
          setLockedUntil(Date.now() + response.retry_after_seconds * 1000)
        }
        pinInput.current?.focus()
        return
      }
      if (!validGuestSession(response)) throw new Error('El acceso recibido no es válido. Inténtalo de nuevo.')
      const nextSession = { session_token: response.session_token, expires_at: response.expires_at }
      rememberGuestSession(token, nextSession)
      setSession(nextSession)
      setPreview({ ...preview, has_pin: true })
      const data = await guestApi.profile(nextSession.session_token)
      if (!mounted.current || current !== requestId.current) return
      setBundle(data)
      setActive(data.participant_id)
      setAssignment(null)
      setLockedUntil(0)
      onToast(preview.has_pin ? '¡Bienvenido de nuevo!' : 'Tu NIP quedó guardado')
    } catch (caught) {
      if (!mounted.current || current !== requestId.current) return
      setPin('')
      setConfirmation('')
      if (isGuestSessionError(caught)) sessionEnded()
      else {
        setError(friendlyError(caught))
        // A successful PIN operation may have been followed by a network failure.
        // Retrying restores that session rather than attempting to register again.
        if (readGuestSession(token)) setBootError(true)
      }
    } finally {
      if (mounted.current && current === requestId.current) setBusy(false)
    }
  }

  async function leave() {
    const current = ++requestId.current
    setBusy(true)
    try {
      if (session) await guestApi.logout(session.session_token)
    } catch {
      // Always remove this tab's access, even if revocation cannot reach the server.
    } finally {
      forgetGuestSession(token)
      if (mounted.current && current === requestId.current) {
        setSession(null)
        setBundle(null)
        setAssignment(null)
        setPin('')
        setConfirmation('')
        setBusy(false)
        onExit()
      }
    }
  }

  function refresh() {
    if (!session) return
    void perform(() => guestApi.profile(session.session_token), data => {
      if (bundle?.event.drawn_at !== data.event.drawn_at) setAssignment(null)
      setBundle(data)
      const selected = data.profiles.find(person => person.id === profile?.id)
        ?? data.profiles.find(person => person.id === data.participant_id)
      if (selected) {
        setActive(selected.id)
        setWishes([0, 1, 2].map(index => selected.wishes?.[index] ?? ''))
        setExtra(selected.extra ?? '')
      }
      onToast('Intercambio actualizado')
    })
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Cargando invitación"><LoaderCircle className="animate-spin text-gray-400" /></div>

  if (bootError || (!preview && !bundle)) return <section className="screen py-10">
    <h1 className="heading">Tu invitación</h1>
    <p role="alert" className="subheading mt-5">{error || 'No pudimos abrir esta invitación.'}</p>
    <button className="btn-primary mt-6" onClick={() => setReload(value => value + 1)}><RefreshCw size={17} />Volver a intentar</button>
    <button className="btn-text mx-auto mt-2" onClick={() => void leave()}>Volver al inicio</button>
  </section>

  if (!session || !bundle || !profile) return <section className="screen pt-4">
    <button className="btn-text -ml-3 mb-6" disabled={busy} onClick={() => void leave()}><ArrowLeft size={17} />Inicio</button>
    <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800"><LockKeyhole size={26} strokeWidth={1.6} /></div>
    <h1 className="heading">Hola, {preview?.participant_name}</h1>
    <p className="subheading">{preview?.title}</p>
    {preview && <div className="mt-4 flex flex-wrap justify-center gap-2"><span className="pill"><CalendarDays size={13} />{formatDate(preview.event_date)}</span><span className="pill">{preview.budget}</span>{preview.gift_type && <span className="pill"><Gift size={13} />{preview.gift_type}</span>}</div>}
    <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">{preview?.has_pin ? 'Ingresa tu NIP para ver tu intercambio.' : 'Crea un NIP para proteger tu intercambio.'}<br /><span className="text-xs">No necesitas crear una cuenta.</span></p>
    <form onSubmit={event => void unlock(event)} aria-busy={busy}>
      <label className="label" htmlFor={`${prefix}-pin`}>{preview?.has_pin ? 'Tu NIP' : 'Crea tu NIP de seis números'}</label>
      <div className="relative">
        <input ref={pinInput} id={`${prefix}-pin`} type={showPin ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete={preview?.has_pin ? 'off' : 'new-password'} autoCapitalize="none" spellCheck={false} className="field pr-12 text-center text-xl tracking-[.55em]" placeholder="••••••" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy || remaining > 0} required />
        <button type="button" aria-label={showPin ? 'Ocultar NIP' : 'Mostrar NIP'} aria-pressed={showPin} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-500" disabled={busy} onClick={() => setShowPin(value => !value)}>{showPin ? <EyeOff size={19} /> : <Eye size={19} />}</button>
      </div>
      {!preview?.has_pin && <><label className="label" htmlFor={`${prefix}-confirmation`}>Confirma tu NIP</label><input id={`${prefix}-confirmation`} type={showPin ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" className="field text-center text-xl tracking-[.55em]" placeholder="••••••" value={confirmation} onChange={event => setConfirmation(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy || remaining > 0} required /><p className="mt-3 text-xs leading-relaxed text-gray-400">Recuerda tu NIP. Lo necesitarás al volver a abrir tu invitación.</p></>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {remaining > 0 && <p role="status" className="mt-3 text-center text-xs text-gray-500">Podrás intentar de nuevo en {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}.</p>}
      <button className="btn-primary mt-6" disabled={busy || remaining > 0}>{busy && <LoaderCircle size={18} className="animate-spin" />}{busy ? 'Un momento…' : preview?.has_pin ? 'Entrar a mi intercambio' : 'Guardar NIP y entrar'}</button>
    </form>
    {preview?.has_pin && <p className="mt-5 text-center text-xs leading-relaxed text-gray-400">¿Olvidaste tu NIP? Pídele al organizador que lo restablezca.</p>}
  </section>

  const event = bundle.event
  return <section className="screen">
    <div className="mb-5 flex items-center justify-between"><button className="btn-text -ml-3" disabled={busy} onClick={() => void leave()}><LogOut size={16} />Salir</button><button className="icon-button" aria-label="Actualizar intercambio" disabled={busy} onClick={refresh}><RefreshCw size={17} /></button></div>
    <h1 className="heading break-words">{event.title}</h1>
    <div className="mt-4 flex flex-wrap justify-center gap-2"><span className="pill"><CalendarDays size={13} />{formatDate(event.event_date)}</span><span className="pill">{event.budget}</span>{event.gift_type && <span className="pill"><Gift size={13} />{event.gift_type}</span>}</div>
    {event.status === 'archived' && <p className="subheading mt-4">Evento archivado · Sólo consulta</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    <div className="mt-7">
      {bundle.profiles.length > 1 ? <><label className="label !mt-0" htmlFor={`${prefix}-profile`}>Viendo perfil de</label><select id={`${prefix}-profile`} className="field mb-5" value={profile.id} disabled={busy} onChange={change => setActive(change.target.value)}>{bundle.profiles.map(person => <option key={person.id} value={person.id}>{person.name}{person.is_child ? ' · Dependiente' : ''}</option>)}</select></> : <p className="mb-5 text-center text-sm font-semibold">{profile.name}</p>}
      <h2 className="mb-4 text-lg font-bold tracking-tight">Tu resultado</h2>
      {event.drawn_at ? <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black p-6 text-white">
        {!assignment ? <button className="flex min-h-48 w-full flex-col items-center justify-center gap-4 rounded-xl focus-visible:outline-white" disabled={busy} onClick={() => void perform(() => guestApi.assignment(session.session_token, profile.id), data => {
          setAssignment(data)
          if (!matchMedia('(prefers-reduced-motion: reduce)').matches) void confetti({ particleCount: 90, spread: 65, origin: { y: .55 } })
        })}><Gift size={45} strokeWidth={1.4} /><span className="text-xs font-bold tracking-widest">{busy ? 'CARGANDO…' : 'TOCA PARA REVELAR'}</span><span className="text-xs text-gray-400">Tu amigo secreto te espera</span></button> : <><p className="text-xs font-bold uppercase tracking-widest text-gray-400">Te tocó regalar a</p><h3 className="my-5 break-words text-4xl font-extrabold tracking-tight">{assignment.target_name}</h3><div className="mt-6 border-t border-white/15 pt-4"><p className="mb-3 text-xs font-semibold text-gray-400">Sus opciones:</p><ul className="space-y-3 text-sm">{assignment.wishes?.some(Boolean) ? assignment.wishes.filter(Boolean).map((wish, index) => <li key={index}><SafeText text={wish} /></li>) : <li className="italic text-gray-400">Sin opciones aún.</li>}</ul>{assignment.extra && <p className="mt-4 border-t border-white/10 pt-4 text-sm"><SafeText text={assignment.extra} /></p>}</div><button type="button" className="mt-5 min-h-8 text-xs text-gray-400 underline" disabled={busy} onClick={() => void perform(() => guestApi.assignment(session.session_token, profile.id), setAssignment)}>Actualizar preferencias</button></>}
      </div> : <div className="panel text-center"><Gift size={28} className="mx-auto mb-3 text-gray-400" /><p className="text-sm text-gray-500">El organizador aún no realiza el sorteo.</p><p className="mt-1 text-xs text-gray-400">Mientras tanto, completa tus preferencias.</p></div>}
      <form className="mt-7" onSubmit={submit => {
        submit.preventDefault()
        if (event.status === 'archived') return
        void perform(() => guestApi.saveWishes(session.session_token, profile.id, wishes, extra), () => {
          setBundle(current => current ? { ...current, profiles: current.profiles.map(person => person.id === profile.id ? { ...person, wishes: [...wishes], extra } : person) } : current)
          onToast('Preferencias guardadas')
        })
      }}>
        <h2 className="text-lg font-bold tracking-tight">Llena el perfil</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Ayuda a tu amigo secreto.</p>
        {[0, 1, 2].map(index => <div key={index}><label className="label" htmlFor={`${prefix}-wish-${index}`}>Opción {index + 1}</label><input id={`${prefix}-wish-${index}`} className="field" maxLength={500} placeholder={['Ej. Libro de terror', 'Ej. Taza de Batman', 'Ej. Calcetas (o un enlace)'][index]} disabled={busy || event.status === 'archived'} value={wishes[index]} onChange={change => setWishes(current => current.map((wish, position) => position === index ? change.target.value : wish))} /></div>)}
        <label className="label" htmlFor={`${prefix}-extra`}>{event.gift_type ? `${event.gift_type} · Información extra` : 'Información extra'}</label><textarea id={`${prefix}-extra`} className="field min-h-24 resize-y" maxLength={1000} placeholder="Talla, color favorito o alguna pista…" value={extra} disabled={busy || event.status === 'archived'} onChange={change => setExtra(change.target.value)} />
        <button className="btn-primary mt-5" disabled={busy || event.status === 'archived'}>{busy && <LoaderCircle size={17} className="animate-spin" />}Guardar preferencias</button>
      </form>
    </div>
  </section>
}

function SafeText({ text }: { text: string }) {
  return <span className="break-words">{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//i.test(part)
    ? <a key={index} href={part} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">{part}</a>
    : part)}</span>
}
