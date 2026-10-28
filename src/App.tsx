import {lazy, Suspense, useEffect, useState} from 'react'
import {UserRound, Plus, ArrowLeft, LogOut, ChevronRight, CalendarDays, Gift, LoaderCircle, Archive, Check, RefreshCw, Settings} from 'lucide-react'
import {Auth} from './components/Auth'
import {AccountSettings} from './components/AccountSettings'
import {useAuth} from './hooks/useAuth'
import {isSupabaseConfigured} from './lib/supabase'
import {EventForm} from './components/EventForm'
import {listEvents, rpc, loadEvent, formatDate, friendlyError} from './lib/api'
import type {ExchangeEvent} from './lib/api'

const EventDashboard = lazy(() => import('./components/EventDashboard').then(module => ({default: module.EventDashboard})))
const GuestExchange = lazy(() => import('./components/GuestExchange').then(module => ({default: module.GuestExchange})))
const initialQuery = new URLSearchParams(window.location.search)
const initialEvent = initialQuery.get('event')
const legacyId = initialQuery.get('id')
const initialToken = new URLSearchParams(window.location.hash.slice(1)).get('invite')
if (initialToken && /^[a-f0-9]{64}$/.test(initialToken)) sessionStorage.setItem('intercambio_invite', initialToken)
type Screen = 'home' | 'auth' | 'events' | 'create' | 'event'

function Loading({label = 'Cargando'}: {label?: string}) {
  return <div className="flex min-h-64 items-center justify-center" aria-label={label} role="status"><LoaderCircle className="animate-spin text-gray-400"/></div>
}

export default function App() {
  const {user, loading, recovering, clearRecovery, signOut, error: authError} = useAuth()
  const [screen, setScreen] = useState<Screen>(initialEvent ? 'event' : 'home')
  const [eventId, setEventId] = useState(initialEvent ?? '')
  const [intent, setIntent] = useState<Screen>('events')
  const [events, setEvents] = useState<ExchangeEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [archived, setArchived] = useState(false)
  const [token, setToken] = useState(sessionStorage.getItem('intercambio_invite'))
  const [authorization, setAuthorization] = useState<{userId: string; allowed: boolean} | null>(null)
  const [authorizationError, setAuthorizationError] = useState('')
  const [authorizationRevision, setAuthorizationRevision] = useState(0)
  const [accountOpen, setAccountOpen] = useState(false)
  const organizer = Boolean(user && authorization?.userId === user.id && authorization.allowed)
  const checkingOrganizer = Boolean(user && authorization?.userId !== user.id)

  useEffect(() => {
    function followInvitation() {
      const next = new URLSearchParams(window.location.hash.slice(1)).get('invite')
      if (next && /^[a-f0-9]{64}$/.test(next)) {
        sessionStorage.setItem('intercambio_invite', next)
        setToken(next)
        setAccountOpen(false)
        clearRecovery()
      } else if (!window.location.hash) {
        sessionStorage.removeItem('intercambio_invite')
        setToken(null)
      }
    }
    window.addEventListener('hashchange', followInvitation)
    return () => window.removeEventListener('hashchange', followInvitation)
  }, [clearRecovery])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!user) {setAuthorization(null); setAuthorizationError(''); return}
    const userId = user.id
    let cancelled = false
    setAuthorization(null)
    setAuthorizationError('')
    rpc<boolean>('is_organizer').then(allowed => {
      if (!cancelled) setAuthorization({userId, allowed})
    }).catch(caught => {
      if (!cancelled) {
        setAuthorization({userId, allowed: false})
        setAuthorizationError(friendlyError(caught))
      }
    })
    return () => {cancelled = true}
  }, [user?.id, authorizationRevision])

  useEffect(() => {
    if (!organizer || screen !== 'events') {setEvents([]); return}
    let cancelled = false
    setEventsLoading(true)
    setError('')
    listEvents().then(data => {if (!cancelled) setEvents(data)})
      .catch(caught => {if (!cancelled) setError(friendlyError(caught))})
      .finally(() => {if (!cancelled) setEventsLoading(false)})
    return () => {cancelled = true}
  }, [screen, user?.id, organizer])

  useEffect(() => {
    if (!legacyId || !organizer) return
    let cancelled = false
    loadEvent(legacyId, true).then(({event}) => {
      if (!cancelled) {
        setEventId(event.id)
        setScreen('event')
        window.history.replaceState({}, '', `/?event=${event.id}`)
      }
    }).catch(() => {
      if (!cancelled) setError('Este enlace pertenece a la versión anterior. Usa una invitación nueva o consulta el sitio original.')
    })
    return () => {cancelled = true}
  }, [organizer])

  function navigate(next: Screen) {
    setError('')
    setScreen(next)
    if (next !== 'event') window.history.replaceState({}, '', '/')
  }
  function requireOrganizer(next: Screen) {
    setIntent(next)
    navigate(user ? next : 'auth')
  }
  function openEvent(id: string) {
    setEventId(id)
    setScreen('event')
    setError('')
    window.history.replaceState({}, '', `/?event=${encodeURIComponent(id)}`)
  }
  function clearInvite() {
    sessionStorage.removeItem('intercambio_invite')
    setToken(null)
    setError('')
    navigate('home')
  }
  async function leaveOrganizer() {
    if (await signOut()) navigate('home')
  }
  async function accountDeleted() {
    setAccountOpen(false)
    setEvents([])
    setAuthorization(user ? {userId: user.id, allowed: false} : null)
    clearRecovery()
    await signOut()
    navigate('home')
    setToast('Tu cuenta de Intercambio fue eliminada')
  }

  const protectedScreen = screen === 'event' || screen === 'events' || screen === 'create'
  const isAuth = recovering || screen === 'auth' || (protectedScreen && !user)
  const filteredEvents = events.filter(event => archived ? event.status === 'archived' : event.status !== 'archived')

  return <div className="flex min-h-dvh items-center justify-center bg-white py-0 dark:bg-black min-[501px]:px-5 min-[501px]:py-10">
    {toast && <div role="status" className="fixed left-1/2 top-5 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white shadow-xl dark:bg-white dark:text-black"><Check size={16}/>{toast}</div>}
    <main className="relative flex min-h-dvh w-full max-w-[500px] flex-col bg-white px-[25px] pt-[30px] pb-2 dark:bg-black min-[501px]:min-h-0 min-[501px]:rounded-2xl min-[501px]:border min-[501px]:border-black/[.02] min-[501px]:pb-7 min-[501px]:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:min-[501px]:border-gray-900 dark:min-[501px]:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)]">
      {screen === 'home' && !token && <button className="icon-button absolute right-5 top-7 z-10" aria-label="Acceso del organizador" onClick={() => requireOrganizer('events')}><UserRound size={20}/></button>}
      {authError && !token && <p role="alert" className="mt-12 mb-4 text-sm text-red-500">{authError}</p>}
      {token && !recovering ? <Suspense fallback={<Loading label="Cargando invitación"/>}><GuestExchange token={token} onExit={clearInvite} onToast={setToast}/></Suspense> : loading ? <Loading label="Cargando sesión"/> :
        isAuth ? <section className="screen pt-10">
          <button className="btn-text -ml-3 mb-4" onClick={() => {clearRecovery(); navigate('home')}}><ArrowLeft size={17}/>Volver</button>
          <h1 className="heading mb-7">{recovering ? 'Nueva contraseña' : 'Acceso del organizador'}</h1>
          <Auth initialMode={recovering ? 'reset' : 'login'} onDone={() => {clearRecovery(); navigate(protectedScreen ? screen : intent)}}/>
        </section> : protectedScreen && checkingOrganizer ? <Loading label="Verificando acceso del organizador"/> : protectedScreen && !organizer ? <section className="screen py-10">
          <h1 className="heading">Acceso del organizador</h1>
          <p className="subheading">{authorizationError || 'Este perfil no tiene acceso de organizador a Intercambio. Los invitados entran desde su enlace personal con un NIP.'}</p>
          {authorizationError && <button className="btn-secondary mt-5" onClick={() => setAuthorizationRevision(value => value + 1)}><RefreshCw size={16}/>Reintentar</button>}
          <button className="btn-primary mt-6" onClick={() => void leaveOrganizer()}><LogOut size={16}/>Cerrar sesión</button>
          <button className="btn-text mx-auto mt-2" onClick={() => navigate('home')}>Volver al inicio</button>
        </section> : screen === 'home' ? <section className="screen flex flex-1 flex-col justify-center min-[501px]:flex-auto">
          <h1 className="mt-0 text-center text-[2.2rem] leading-[1.25] font-extrabold tracking-[-.04em] text-gray-950 dark:text-white">Intercambio</h1>
          <p className="mt-10 mb-12 text-center text-[.95rem] leading-relaxed text-gray-500 dark:text-gray-400">Organiza intercambios de forma sencilla.</p>
          <button className="btn-primary" onClick={() => requireOrganizer('create')}><Plus size={20}/>Crear Nuevo Sorteo</button>
          <button className="btn-text mx-auto mt-3 dark:text-white" onClick={() => requireOrganizer('events')}>{organizer ? 'Ver mis eventos' : 'Entrar como organizador'}<ChevronRight size={14}/></button>
          <p className="mx-auto mt-5 max-w-80 text-center text-xs leading-relaxed text-gray-400">¿Te invitaron? Abre tu enlace personal para entrar con tu NIP. No necesitas crear una cuenta.</p>
          {legacyId && <p className="mt-5 text-center text-xs text-gray-400">Este enlace es de la versión anterior. El organizador puede buscar el evento migrado.</p>}
          {!isSupabaseConfigured && <p role="status" className="mt-5 text-center text-xs text-gray-400">Estamos preparando el servicio.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        </section> : screen === 'create' ? <EventForm onCancel={() => navigate('events')} onSaved={id => {openEvent(id); setToast('¡Evento creado!')}}/> : screen === 'event' && user ? <Suspense fallback={<Loading label="Cargando evento"/>}><EventDashboard key={`${eventId}:${user.id}`} id={eventId} userId={user.id} onBack={() => navigate('events')} onToast={setToast}/></Suspense> : <section className="screen">
          <button className="btn-text -ml-3 mb-5" onClick={() => navigate('home')}><ArrowLeft size={17}/>Inicio</button>
          <h1 className="heading">Mis eventos</h1><p className="subheading mb-6">Tus intercambios, en un solo lugar.</p>
          <button className="btn-primary" onClick={() => navigate('create')}><Plus size={19}/>Crear nuevo evento</button>
          <div className="my-5 flex items-center justify-between"><span className="text-xs text-gray-400">{filteredEvents.length} {filteredEvents.length === 1 ? 'evento' : 'eventos'}</span><button className="btn-text !min-h-8 !text-xs" onClick={() => setArchived(!archived)}>{archived ? <ArrowLeft size={13}/> : <Archive size={13}/>} {archived ? 'Ver activos' : 'Archivados'}</button></div>
          {eventsLoading ? <Loading label="Cargando eventos"/> : error ? <div className="panel"><p role="alert" className="text-sm text-red-600">{error}</p><button className="btn-text mt-2" onClick={() => {setError(''); setEventsLoading(true); listEvents().then(setEvents).catch(caught => setError(friendlyError(caught))).finally(() => setEventsLoading(false))}}><RefreshCw size={14}/>Reintentar</button></div> : filteredEvents.length === 0 ? <div className="my-8 text-center">
            <Gift size={34} strokeWidth={1.3} className="mx-auto mb-4 text-gray-300 dark:text-gray-700"/><h2 className="text-sm font-semibold">{archived ? 'Sin eventos archivados' : 'Aquí comienza tu próximo intercambio'}</h2><p className="mx-auto mt-2 max-w-72 text-xs leading-relaxed text-gray-400">{archived ? 'Los eventos que archives aparecerán aquí.' : 'Crea un evento y comparte una invitación personal con cada adulto.'}</p>
          </div> : <div className="space-y-3">{filteredEvents.map(event => <button key={event.id} onClick={() => openEvent(event.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 p-4 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-950">
            <div className="min-w-0"><h2 className="truncate text-sm font-bold">{event.title}</h2><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400"><span className="flex items-center gap-1"><CalendarDays size={12}/>{formatDate(event.event_date)}</span><span>{event.budget}</span></div><p className="mt-2 text-[10px] font-semibold tracking-wide text-gray-500">{event.status === 'draft' ? 'PENDIENTE' : event.status === 'drawn' ? 'SORTEADO' : 'ARCHIVADO'}</p></div><ChevronRight size={17} className="shrink-0 text-gray-400"/>
          </button>)}</div>}
          <div className="mt-7 border-t border-gray-100 pt-4 dark:border-gray-900"><p className="truncate text-center text-xs text-gray-400">{user?.email}</p><div className="mt-2 flex justify-between"><button className="btn-text !text-xs" onClick={() => setAccountOpen(true)}><Settings size={14}/>Mi cuenta</button><button className="btn-text !text-xs" onClick={() => void leaveOrganizer()}><LogOut size={13}/>Salir</button></div></div>
        </section>}
      <footer className="mt-auto pt-10 pb-6 text-center text-[.65rem] font-semibold tracking-[2px] text-gray-300 uppercase dark:text-gray-700">Development by VNGAS</footer>
    </main>
    {accountOpen && organizer && user && <AccountSettings email={user.email ?? ''} onClose={() => setAccountOpen(false)} onDeleted={accountDeleted}/>}
  </div>
}
