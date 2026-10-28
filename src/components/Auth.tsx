import { useEffect, useId, useState, type FormEvent } from 'react'
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'
type AuthProps = { onDone: () => void; initialMode?: AuthMode }

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

  useEffect(() => {
    setMode(initialMode); setError(''); setNotice(''); setPassword(''); setConfirmation(''); setVisiblePassword(false)
  }, [initialMode])

  function changeMode(next: AuthMode) {
    setMode(next); setError(''); setNotice(''); setPassword(''); setConfirmation(''); setVisiblePassword(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setNotice('')
    if (!supabase) { setError('El servicio de cuentas todavía no está disponible. Inténtalo más tarde.'); return }
    if ((mode === 'signup' || mode === 'reset') && password !== confirmation) { setError('Las contraseñas no coinciden.'); return }
    if (mode === 'signup' && !name.trim()) { setError('Escribe tu nombre para continuar.'); return }
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (failure) throw failure
        onDone()
      } else if (mode === 'signup') {
        const { data, error: failure } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/` },
        })
        if (failure) throw failure
        if (data.session) onDone()
        else {
          setNotice('Revisa tu correo para confirmar tu cuenta. Después inicia sesión para continuar. Si llegaste por una invitación, vuelve a abrir ese enlace tras confirmar tu correo.')
          setPassword(''); setConfirmation('')
        }
      } else if (mode === 'forgot') {
        const { error: failure } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` })
        if (failure) throw failure
        setNotice('Si existe una cuenta con ese correo, recibirás un enlace para elegir una nueva contraseña. Revisa también spam.')
      } else {
        const { error: failure } = await supabase.auth.updateUser({ password })
        if (failure) throw failure
        setPassword(''); setConfirmation(''); onDone()
      }
    } catch (caught) {
      setError(authMessage(caught && typeof caught === 'object' ? caught : {}))
    } finally { setBusy(false) }
  }

  const newPassword = mode === 'signup' || mode === 'reset'
  const action = { login: 'Iniciar sesión', signup: 'Crear mi cuenta', forgot: 'Enviar enlace', reset: 'Guardar contraseña' }[mode]
  const tabClass = (selected: boolean) => `rounded-lg px-3 py-2.5 text-sm font-semibold transition ${selected ? 'bg-white text-gray-900 shadow-sm dark:bg-white dark:text-black' : 'text-gray-500 hover:text-gray-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950'}`

  return <div>
    {(mode === 'login' || mode === 'signup') ? <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-neutral-800 dark:bg-black">
      <button type="button" disabled={busy} onClick={() => changeMode('login')} aria-pressed={mode === 'login'} className={tabClass(mode === 'login')}>Iniciar sesión</button>
      <button type="button" disabled={busy} onClick={() => changeMode('signup')} aria-pressed={mode === 'signup'} className={tabClass(mode === 'signup')}>Registrarme</button>
    </div> : <p className="mb-6 text-sm leading-relaxed text-gray-500 dark:text-gray-400">{mode === 'forgot' ? 'Te enviaremos un enlace para recuperar el acceso a tu cuenta.' : 'Elige una nueva contraseña para tu cuenta.'}</p>}
    <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
      {mode === 'signup' && <div><label htmlFor={`${prefix}-name`} className="label mt-0">Tu nombre</label><input id={`${prefix}-name`} className="field" value={name} onChange={event => setName(event.target.value)} autoComplete="name" placeholder="¿Cómo te llamas?" maxLength={80} required disabled={busy}/></div>}
      {mode !== 'reset' && <div><label htmlFor={`${prefix}-email`} className="label mt-0">Correo electrónico</label><input id={`${prefix}-email`} className="field" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="tu@correo.com" maxLength={254} required disabled={busy}/></div>}
      {mode !== 'forgot' && <div><label htmlFor={`${prefix}-password`} className="label mt-0">{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label><div className="relative"><input id={`${prefix}-password`} className="field pr-12" type={visiblePassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={newPassword ? 'new-password' : 'current-password'} placeholder={newPassword ? 'Al menos 8 caracteres' : 'Tu contraseña'} minLength={newPassword ? 8 : undefined} maxLength={128} required disabled={busy}/><button type="button" aria-label={visiblePassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visiblePassword} onClick={() => setVisiblePassword(value => !value)} disabled={busy} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">{visiblePassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></div>}
      {newPassword && <div><label htmlFor={`${prefix}-confirmation`} className="label mt-0">Confirmar contraseña</label><input id={`${prefix}-confirmation`} className="field" type={visiblePassword ? 'text' : 'password'} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" placeholder="Vuelve a escribirla" minLength={8} maxLength={128} required disabled={busy}/></div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-black dark:text-gray-200"><Mail size={18} className="mt-0.5 shrink-0"/>{notice}</p>}
      <button type="submit" disabled={busy || !supabase} className="btn-primary">{busy && <LoaderCircle size={18} className="animate-spin"/>}{busy ? 'Un momento…' : action}</button>
      {!supabase && <p role="status" className="text-center text-xs text-gray-500">El servicio de cuentas todavía no está activado.</p>}
    </form>
    {mode === 'login' && <button type="button" disabled={busy} onClick={() => changeMode('forgot')} className="btn-text mx-auto mt-4">Olvidé mi contraseña</button>}
    {mode === 'forgot' && <button type="button" disabled={busy} onClick={() => changeMode('login')} className="btn-text mx-auto mt-4"><ArrowLeft size={16}/>Volver a iniciar sesión</button>}
  </div>
}
