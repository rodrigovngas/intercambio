import { useEffect, useId, useState, type FormEvent } from 'react'
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'
type AuthProps = { onDone: () => void; initialMode?: AuthMode }

const inputClass = 'field'
const labelClass = 'label mt-0'
const buttonClass = 'btn-primary'

function authMessage(error: { message?: string; code?: string }) {
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message ?? '')) return 'El correo o la contraseña no son correctos.'
  if (error.code === 'email_not_confirmed') return 'Confirma tu correo antes de iniciar sesión. Revisa también la carpeta de spam.'
  if (error.code === 'signup_disabled') return 'El registro de cuentas todavía no está habilitado. Inténtalo más tarde.'
  if (error.code === 'email_address_invalid') return 'Revisa que tu correo electrónico esté escrito correctamente.'
  if (error.code === 'email_address_not_authorized') return 'El servicio de correo aún está en configuración. No podemos enviar la confirmación a esa dirección por ahora.'
  if (error.code === 'user_already_exists' || /already registered/i.test(error.message ?? '')) return 'Ya existe una cuenta con este correo. Puedes iniciar sesión o recuperar tu contraseña.'
  if (error.code === 'weak_password') return 'Elige una contraseña más segura, de al menos 8 caracteres.'
  if (error.code === 'same_password') return 'Elige una contraseña diferente a la anterior.'
  if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') return 'Se han enviado varias solicitudes. Espera unos minutos y vuelve a intentarlo.'
  if (error.code === 'otp_expired' || error.code === 'bad_code_verifier' || /expired|invalid token/i.test(error.message ?? '')) return 'El enlace expiró o ya fue utilizado. Solicita uno nuevo.'
  if (/fetch|network/i.test(error.message ?? '')) return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
  return 'No pudimos completar la solicitud. Inténtalo de nuevo en unos minutos.'
}

export function Auth({ onDone, initialMode = 'login' }: AuthProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const prefix = useId()

  useEffect(() => { setMode(initialMode); setError(''); setNotice('') }, [initialMode])

  function changeMode(next: AuthMode) {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
    setConfirmation('')
    setVisiblePassword(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    const client = supabase
    if (!client) {
      setError('Las cuentas estarán disponibles cuando se active el servicio de Supabase.')
      return
    }
    if ((mode === 'signup' || mode === 'reset') && password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (mode === 'signup' && !name.trim()) {
      setError('Escribe tu nombre para continuar.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (result.error) throw result.error
        onDone()
      } else if (mode === 'signup') {
        const result = await client.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/` },
        })
        if (result.error) throw result.error
        if (result.data.session) onDone()
        else {
          setNotice('Revisa tu correo para confirmar tu cuenta. Después podrás iniciar sesión y crear tus eventos.')
          setPassword('')
          setConfirmation('')
        }
      } else if (mode === 'forgot') {
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` })
        if (result.error) throw result.error
        setNotice('Si existe una cuenta con ese correo, recibirás un enlace para elegir una nueva contraseña. Revisa también spam.')
      } else {
        const result = await client.auth.updateUser({ password })
        if (result.error) throw result.error
        setPassword('')
        setConfirmation('')
        onDone()
      }
    } catch (caught) {
      setError(authMessage(caught && typeof caught === 'object' ? caught : {}))
    } finally {
      setBusy(false)
    }
  }

  const usesPassword = mode !== 'forgot'
  const newPassword = mode === 'signup' || mode === 'reset'
  const action = { login: 'Iniciar sesión', signup: 'Crear mi cuenta', forgot: 'Enviar enlace', reset: 'Guardar contraseña' }[mode]

  return <div>
    {(mode === 'login' || mode === 'signup') ? <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-neutral-800 dark:bg-black">
      <button type="button" disabled={busy} onClick={() => changeMode('login')} aria-pressed={mode === 'login'} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'login' ? 'bg-white text-gray-900 shadow-sm dark:bg-white dark:text-black' : 'text-gray-500 hover:text-gray-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950'}`}>Iniciar sesión</button>
      <button type="button" disabled={busy} onClick={() => changeMode('signup')} aria-pressed={mode === 'signup'} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${mode === 'signup' ? 'bg-white text-gray-900 shadow-sm dark:bg-white dark:text-black' : 'text-gray-500 hover:text-gray-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950'}`}>Registrarme</button>
    </div> : <p className="mb-6 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{mode === 'forgot' ? 'Te enviaremos un enlace para recuperar el acceso a tu cuenta.' : 'Elige una nueva contraseña para tu cuenta.'}</p>}
    <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
      {mode === 'signup' && <div><label htmlFor={`${prefix}-name`} className={labelClass}>Tu nombre</label><input id={`${prefix}-name`} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="¿Cómo te llamas?" maxLength={80} required disabled={busy} className={inputClass} /></div>}
      {mode !== 'reset' && <div><label htmlFor={`${prefix}-email`} className={labelClass}>Correo electrónico</label><input id={`${prefix}-email`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="tu@correo.com" maxLength={254} required disabled={busy} className={inputClass} /></div>}
      {usesPassword && <div><label htmlFor={`${prefix}-password`} className={labelClass}>{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label><div className="relative"><input id={`${prefix}-password`} type={visiblePassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={newPassword ? 'new-password' : 'current-password'} placeholder={newPassword ? 'Al menos 8 caracteres' : 'Tu contraseña'} minLength={newPassword ? 8 : undefined} maxLength={128} required disabled={busy} className={`${inputClass} pr-12`} /><button type="button" aria-label={visiblePassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visiblePassword} onClick={() => setVisiblePassword((value) => !value)} disabled={busy} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">{visiblePassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></div></div>}
      {newPassword && <div><label htmlFor={`${prefix}-confirmation`} className={labelClass}>Confirmar contraseña</label><input id={`${prefix}-confirmation`} type={visiblePassword ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" placeholder="Vuelve a escribirla" minLength={8} maxLength={128} required disabled={busy} className={inputClass} /></div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><Mail size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{notice}</p>}
      <button type="submit" disabled={busy || !supabase} className={buttonClass}>{busy && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}{busy ? 'Un momento…' : action}</button>
      {!supabase && <p role="status" className="text-center text-xs leading-relaxed text-gray-500">El servicio de cuentas todavía no está activado.</p>}
    </form>
    {mode === 'login' && <button type="button" disabled={busy} onClick={() => changeMode('forgot')} className="mt-5 w-full rounded-lg py-2 text-center text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">Olvidé mi contraseña</button>}
    {mode === 'forgot' && <button type="button" disabled={busy} onClick={() => changeMode('login')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"><ArrowLeft size={16} aria-hidden="true" />Volver a iniciar sesión</button>}
  </div>
}
