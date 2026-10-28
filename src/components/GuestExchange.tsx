import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Gift,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
} from 'lucide-react'
import { celebrateReveal } from '../lib/celebrateReveal'
import { friendlyError } from '../lib/api'
import { AssignmentDetails } from './AssignmentDetails'
import { EventMetadata } from './EventMetadata'
import { GiftPreferencesFields } from './GiftPreferencesFields'

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

const expiredMessage =
  'Tu sesión de invitado terminó. Vuelve a entrar para consultar tu intercambio.'

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
  const [storedAssignment, setStoredAssignment] = useState<{
    key: string
    value: Assignment
  } | null>(null)
  const [restoringKey, setRestoringKey] = useState<string | null>(null)
  const [restoreRevision, setRestoreRevision] = useState(0)
  const [pinInvalid, setPinInvalid] = useState(false)
  const [pinAnimating, setPinAnimating] = useState(false)
  const [pinErrorRevision, setPinErrorRevision] = useState(0)
  const [wishes, setWishes] = useState(['', '', ''])
  const [extra, setExtra] = useState('')
  const mounted = useRef(true)
  const requestId = useRef(0)
  const assignmentRequestId = useRef(0)
  const pinResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinInput = useRef<HTMLInputElement>(null)
  const prefix = useId()
  const profile =
    bundle?.profiles.find((person) => person.id === active) ??
    bundle?.profiles.find((person) => person.id === bundle.participant_id) ??
    bundle?.profiles[0]
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))
  const assignmentKey =
    session && profile && bundle?.event.drawn_at
      ? `${session.session_token}:${profile.id}:${bundle.event.drawn_at}`
      : ''
  const assignment = storedAssignment?.key === assignmentKey ? storedAssignment.value : null
  const restoringResult = restoringKey === assignmentKey && Boolean(assignmentKey)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestId.current += 1
      assignmentRequestId.current += 1
      if (pinResetTimer.current) clearTimeout(pinResetTimer.current)
    }
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
      if (
        invitation.status === 'rejected' &&
        !(restored.status === 'fulfilled' && restored.value)
      ) {
        setBootError(true)
        setError(friendlyError(invitation.reason))
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token, reload])

  useEffect(() => {
    if (!profile) return
    setWishes([0, 1, 2].map((index) => profile.wishes?.[index] ?? ''))
    setExtra(profile.extra ?? '')
  }, [profile?.id])

  useEffect(() => {
    const sessionToken = session?.session_token
    const participantId = profile?.id
    const drawnAt = bundle?.event.drawn_at
    if (!sessionToken || !participantId || !drawnAt || !profile.revealed || assignment) return
    let cancelled = false
    const current = ++assignmentRequestId.current
    setRestoringKey(assignmentKey)
    // Restoration never marks a result as seen. The server checks the draw
    // timestamp as well, so a simultaneous redraw remains a new surprise.
    guestApi
      .restoreAssignment(sessionToken, participantId, drawnAt)
      .then(async (result) => {
        if (cancelled || !mounted.current || current !== assignmentRequestId.current) return
        if (result) {
          setStoredAssignment({ key: assignmentKey, value: result })
        } else {
          const updated = await guestApi.profile(sessionToken)
          if (!cancelled && mounted.current && current === assignmentRequestId.current)
            setBundle(updated)
        }
      })
      .catch((caught) => {
        if (cancelled || !mounted.current || current !== assignmentRequestId.current) return
        if (isGuestSessionError(caught)) sessionEnded()
        else setError(friendlyError(caught))
      })
      .finally(() => {
        if (!cancelled && mounted.current && current === assignmentRequestId.current)
          setRestoringKey(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    session?.session_token,
    profile?.id,
    profile?.revealed,
    bundle?.event.drawn_at,
    assignmentKey,
    restoreRevision,
  ])

  useEffect(() => {
    if (!session) return
    const timeout = setTimeout(
      sessionEnded,
      Math.max(0, Date.parse(session.expires_at) - Date.now()),
    )
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

  useEffect(() => {
    if (pinInvalid && !pinAnimating && !busy && remaining === 0) pinInput.current?.focus()
  }, [pinInvalid, pinAnimating, busy, remaining])

  function sessionEnded() {
    requestId.current += 1
    assignmentRequestId.current += 1
    forgetGuestSession(token)
    setSession(null)
    setBundle(null)
    setStoredAssignment(null)
    setRestoringKey(null)
    clearPinFeedback()
    setPin('')
    setConfirmation('')
    setBusy(false)
    setBootError(false)
    setError(expiredMessage)
    // A reset revokes sessions and removes the old PIN. Refresh this flag so the
    // same open invitation can offer PIN creation without requiring a page reload.
    const current = requestId.current
    void guestApi
      .preview(token)
      .then((data) => {
        if (mounted.current && current === requestId.current) setPreview(data)
      })
      .catch(() => {})
  }

  function clearPinFeedback() {
    if (pinResetTimer.current) clearTimeout(pinResetTimer.current)
    pinResetTimer.current = null
    setPinAnimating(false)
    setPinInvalid(false)
  }

  function showIncorrectPin(currentRequest: number) {
    clearPinFeedback()
    setPinInvalid(true)
    setPinErrorRevision((value) => value + 1)
    setConfirmation('')
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPin('')
      return
    }
    setPinAnimating(true)
    pinResetTimer.current = setTimeout(() => {
      pinResetTimer.current = null
      if (!mounted.current || currentRequest !== requestId.current) return
      setPin('')
      setPinAnimating(false)
    }, 350)
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
    if (!preview || busy || pinAnimating || remaining > 0) return
    clearPinFeedback()
    setError('')
    if (!/^\d{6}$/.test(pin)) {
      setError('Tu NIP debe tener exactamente seis números.')
      return
    }
    if (!preview.has_pin && pin !== confirmation) {
      setError('Los NIP no coinciden. Vuelve a confirmarlo.')
      return
    }
    const current = ++requestId.current
    setBusy(true)
    try {
      const response = await guestApi.unlock(token, pin, !preview.has_pin)
      if (!mounted.current || current !== requestId.current) return
      if (!response.ok) {
        setError(response.error)
        if (/^El NIP no es correcto\.|^Demasiados intentos\./i.test(response.error)) {
          showIncorrectPin(current)
        } else {
          setPin('')
          setConfirmation('')
        }
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
      setPin('')
      setConfirmation('')
      clearPinFeedback()
      if (!validGuestSession(response))
        throw new Error('El acceso recibido no es válido. Inténtalo de nuevo.')
      const nextSession = { session_token: response.session_token, expires_at: response.expires_at }
      rememberGuestSession(token, nextSession)
      setSession(nextSession)
      setPreview({ ...preview, has_pin: true })
      const data = await guestApi.profile(nextSession.session_token)
      if (!mounted.current || current !== requestId.current) return
      setBundle(data)
      setActive(data.participant_id)
      setStoredAssignment(null)
      setLockedUntil(0)
      onToast(preview.has_pin ? '¡Bienvenido de nuevo!' : 'Tu NIP quedó guardado')
    } catch (caught) {
      if (!mounted.current || current !== requestId.current) return
      clearPinFeedback()
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
    assignmentRequestId.current += 1
    clearPinFeedback()
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
        setStoredAssignment(null)
        setRestoringKey(null)
        setPin('')
        setConfirmation('')
        setBusy(false)
        onExit()
      }
    }
  }

  function refresh() {
    if (!session) return
    void perform(
      () => guestApi.profile(session.session_token),
      (data) => {
        if (bundle?.event.drawn_at !== data.event.drawn_at) setStoredAssignment(null)
        setBundle(data)
        const selected =
          data.profiles.find((person) => person.id === profile?.id) ??
          data.profiles.find((person) => person.id === data.participant_id)
        if (selected) {
          setActive(selected.id)
          setWishes([0, 1, 2].map((index) => selected.wishes?.[index] ?? ''))
          setExtra(selected.extra ?? '')
        }
        onToast('Intercambio actualizado')
      },
    )
  }

  if (loading)
    return (
      <div
        className="flex min-h-64 items-center justify-center"
        role="status"
        aria-label="Cargando invitación"
      >
        <LoaderCircle className="animate-spin text-gray-400" />
      </div>
    )

  if (bootError || (!preview && !bundle))
    return (
      <section className="screen py-10">
        <h1 className="heading">Tu invitación</h1>
        <p role="alert" className="subheading mt-5">
          {error || 'No pudimos abrir esta invitación.'}
        </p>
        <button className="btn-primary mt-6" onClick={() => setReload((value) => value + 1)}>
          <RefreshCw size={17} />
          Volver a intentar
        </button>
        <button className="btn-text mx-auto mt-2" onClick={() => void leave()}>
          Volver al inicio
        </button>
      </section>
    )

  if (!session || !bundle || !profile)
    return (
      <section className="screen pt-4">
        <button
          className="btn-text -ml-3 mb-6"
          disabled={busy || pinAnimating}
          onClick={() => void leave()}
        >
          <ArrowLeft size={17} />
          Inicio
        </button>
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800">
          <LockKeyhole size={26} strokeWidth={1.6} />
        </div>
        <h1 className="heading">Hola, {preview?.participant_name}</h1>
        <p className="subheading">{preview?.title}</p>
        {preview && <EventMetadata event={preview} />}
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {preview?.has_pin
            ? 'Ingresa tu NIP para ver tu intercambio.'
            : 'Crea un NIP para proteger tu intercambio.'}
          <br />
          <span className="text-xs">No necesitas crear una cuenta.</span>
        </p>
        <form onSubmit={(event) => void unlock(event)} aria-busy={busy}>
          <label className="label" htmlFor={`${prefix}-pin`}>
            {preview?.has_pin ? 'Tu NIP' : 'Crea tu NIP de seis números'}
          </label>
          <PinInput
            id={`${prefix}-pin`}
            inputRef={pinInput}
            value={pin}
            onChange={(value) => {
              clearPinFeedback()
              setPin(value)
            }}
            visible={showPin}
            onToggleVisibility={() => setShowPin((value) => !value)}
            disabled={busy || pinAnimating || remaining > 0}
            invalid={pinInvalid}
            errorId={error ? `${prefix}-pin-error` : undefined}
            shakeRevision={pinErrorRevision}
          />
          {!preview?.has_pin && (
            <>
              <label className="label" htmlFor={`${prefix}-confirmation`}>
                Confirma tu NIP
              </label>
              <PinInput
                id={`${prefix}-confirmation`}
                value={confirmation}
                onChange={setConfirmation}
                visible={showPin}
                disabled={busy || pinAnimating || remaining > 0}
                errorId={error ? `${prefix}-pin-error` : undefined}
              />
              <p className="mt-3 text-xs leading-relaxed text-gray-400">
                Recuerda tu NIP. Lo necesitarás al volver a abrir tu invitación.
              </p>
            </>
          )}
          {error && (
            <p
              id={`${prefix}-pin-error`}
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}
          {remaining > 0 && (
            <p role="status" className="mt-3 text-center text-xs text-gray-500">
              Podrás intentar de nuevo en {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, '0')}.
            </p>
          )}
          <button className="btn-primary mt-6" disabled={busy || pinAnimating || remaining > 0}>
            {busy && <LoaderCircle size={18} className="animate-spin" />}
            {busy
              ? 'Un momento…'
              : preview?.has_pin
                ? 'Entrar a mi intercambio'
                : 'Guardar NIP y entrar'}
          </button>
        </form>
        {preview?.has_pin && (
          <p className="mt-5 text-center text-xs leading-relaxed text-gray-400">
            ¿Olvidaste tu NIP? Pídele al organizador que lo restablezca.
          </p>
        )}
      </section>
    )

  const event = bundle.event
  return (
    <section className="screen">
      <div className="mb-5 flex items-center justify-between">
        <button className="btn-text -ml-3" disabled={busy} onClick={() => void leave()}>
          <LogOut size={16} />
          Salir
        </button>
        <button
          className="icon-button"
          aria-label="Actualizar intercambio"
          disabled={busy}
          onClick={refresh}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <h1 className="heading break-words">{event.title}</h1>
      <EventMetadata event={event} />
      {event.status === 'archived' && (
        <p className="subheading mt-4">Evento archivado · Sólo consulta</p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="mt-7">
        {bundle.profiles.length > 1 ? (
          <>
            <label className="label !mt-0" htmlFor={`${prefix}-profile`}>
              Viendo perfil de
            </label>
            <select
              id={`${prefix}-profile`}
              className="field mb-5"
              value={profile.id}
              disabled={busy}
              onChange={(change) => setActive(change.target.value)}
            >
              {bundle.profiles.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.is_child ? ' · Dependiente' : ''}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="mb-5 text-center text-sm font-semibold">{profile.name}</p>
        )}
        <h2 className="mb-4 text-lg font-bold tracking-tight">Tu resultado</h2>
        {event.drawn_at ? (
          <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black p-6 text-white">
            {!assignment ? (
              profile.revealed ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-center">
                  {restoringResult ? (
                    <>
                      <LoaderCircle size={30} className="animate-spin" aria-hidden="true" />
                      <p role="status" className="text-sm text-gray-300">
                        Cargando tu resultado…
                      </p>
                    </>
                  ) : (
                    <>
                      <Gift size={38} strokeWidth={1.4} />
                      <p className="text-sm text-gray-300">Tu resultado ya fue revelado.</p>
                      <button
                        className="min-h-11 rounded-lg px-3 text-sm font-semibold underline underline-offset-4"
                        disabled={busy}
                        onClick={() => setRestoreRevision((value) => value + 1)}
                      >
                        Volver a cargar resultado
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button
                  className="flex min-h-48 w-full flex-col items-center justify-center gap-4 rounded-xl focus-visible:outline-white"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () => guestApi.assignment(session.session_token, profile.id),
                      (data) => {
                        setStoredAssignment({ key: assignmentKey, value: data })
                        setBundle((current) =>
                          current
                            ? {
                                ...current,
                                profiles: current.profiles.map((person) =>
                                  person.id === profile.id ? { ...person, revealed: true } : person,
                                ),
                              }
                            : current,
                        )
                        celebrateReveal()
                      },
                    )
                  }
                >
                  <Gift size={45} strokeWidth={1.4} />
                  <span className="text-xs font-bold tracking-widest">
                    {busy ? 'CARGANDO…' : 'TOCA PARA REVELAR'}
                  </span>
                  <span className="text-xs text-gray-400">Tu amigo secreto te espera</span>
                </button>
              )
            ) : (
              <>
                <AssignmentDetails assignment={assignment} />
                <button
                  type="button"
                  className="mt-5 min-h-8 text-xs text-gray-400 underline"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () =>
                        guestApi.restoreAssignment(
                          session.session_token,
                          profile.id,
                          event.drawn_at!,
                        ),
                      (data) => {
                        if (data) setStoredAssignment({ key: assignmentKey, value: data })
                        else {
                          setStoredAssignment(null)
                          refresh()
                        }
                      },
                    )
                  }
                >
                  Actualizar preferencias
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="panel text-center">
            <Gift size={28} className="mx-auto mb-3 text-gray-400" />
            <p className="text-sm text-gray-500">El organizador aún no realiza el sorteo.</p>
            <p className="mt-1 text-xs text-gray-400">Mientras tanto, completa tus preferencias.</p>
          </div>
        )}
        <form
          className="mt-7"
          onSubmit={(submit) => {
            submit.preventDefault()
            if (event.status === 'archived') return
            void perform(
              () => guestApi.saveWishes(session.session_token, profile.id, wishes, extra),
              () => {
                setBundle((current) =>
                  current
                    ? {
                        ...current,
                        profiles: current.profiles.map((person) =>
                          person.id === profile.id
                            ? { ...person, wishes: [...wishes], extra }
                            : person,
                        ),
                      }
                    : current,
                )
                onToast('Preferencias guardadas')
              },
            )
          }}
        >
          <h2 className="text-lg font-bold tracking-tight">Llena el perfil</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Ayuda a tu amigo secreto.</p>
          <GiftPreferencesFields
            wishes={wishes}
            extra={extra}
            giftType={event.gift_type}
            idPrefix={`${prefix}-`}
            inputsDisabled={busy || event.status === 'archived'}
            onWishChange={(index, value) =>
              setWishes((current) =>
                current.map((wish, position) => (position === index ? value : wish)),
              )
            }
            onExtraChange={setExtra}
          />
          <button className="btn-primary mt-5" disabled={busy || event.status === 'archived'}>
            {busy && <LoaderCircle size={17} className="animate-spin" />}Guardar preferencias
          </button>
        </form>
      </div>
    </section>
  )
}

type PinInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  disabled: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onToggleVisibility?: () => void
  invalid?: boolean
  errorId?: string
  shakeRevision?: number
}

function PinInput({
  id,
  value,
  onChange,
  visible,
  disabled,
  inputRef,
  onToggleVisibility,
  invalid = false,
  errorId,
  shakeRevision = 0,
}: PinInputProps) {
  return (
    <div
      className="field pin-field"
      data-invalid={invalid}
      data-visible={visible}
      data-disabled={disabled}
      data-toggle={Boolean(onToggleVisibility)}
    >
      <input
        ref={inputRef}
        id={id}
        type={visible ? 'text' : 'password'}
        inputMode="numeric"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="pin-native-input"
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={disabled}
        required
      />
      {!visible && (
        <div
          key={shakeRevision}
          className={`pin-dots${invalid ? ' pin-shake' : ''}`}
          aria-hidden="true"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="pin-dot" data-filled={index < value.length} />
          ))}
        </div>
      )}
      {onToggleVisibility && (
        <button
          type="button"
          aria-label={visible ? 'Ocultar NIP' : 'Mostrar NIP'}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500"
          disabled={disabled}
          onClick={onToggleVisibility}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      )}
    </div>
  )
}
