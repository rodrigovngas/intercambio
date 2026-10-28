import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Archive,
  RotateCcw,
  Gift,
  Users,
  Link as LinkIcon,
  Pencil,
  Shuffle,
  Copy,
  Share2,
  LoaderCircle,
  Plus,
  X,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  Trash2,
  KeyRound,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { celebrateReveal } from '../lib/celebrateReveal'
import { Modal } from './Modal'
import { EventForm } from './EventForm'
import { AssignmentDetails } from './AssignmentDetails'
import { EventMetadata } from './EventMetadata'
import { GiftPreferencesFields } from './GiftPreferencesFields'

import { loadEvent, rpc, friendlyError, invitationUrl } from '../lib/api'
import type { Assignment, ExchangeEvent, Participant, Invitation, MyProfileState } from '../lib/api'

type EventDashboardProps = {
  id: string
  userId: string
  onBack: () => void
  onToast: (message: string) => void
}

function loadDashboard(eventId: string) {
  return Promise.all([
    loadEvent(eventId),
    rpc<MyProfileState>('my_profile_state', { p_event_id: eventId }),
  ])
}

export function EventDashboard({ id, userId, onBack, onToast }: EventDashboardProps) {
  const [event, setEvent] = useState<ExchangeEvent | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [selectedInvitation, setSelectedInvitation] = useState<Invitation | null>(null)
  const [pendingAction, setPendingAction] = useState<
    'draw' | 'redraw' | 'archive' | 'delete' | null
  >(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [invitationToReset, setInvitationToReset] = useState<Invitation | null>(null)
  const [participantFormOpen, setParticipantFormOpen] = useState(false)
  const [newParticipantName, setNewParticipantName] = useState('')
  const [newParticipantIsChild, setNewParticipantIsChild] = useState(false)
  const [newParticipantGuardianId, setNewParticipantGuardianId] = useState('')
  const [activeProfileId, setActiveProfileId] = useState('')
  const [storedAssignment, setStoredAssignment] = useState<{
    key: string
    value: Assignment
  } | null>(null)
  const [profileState, setProfileState] = useState<MyProfileState | null>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [resultRevision, setResultRevision] = useState(0)
  const resultCache = useRef(new Map<string, Assignment>())
  const [wishes, setWishes] = useState(['', '', ''])
  const [extra, setExtra] = useState('')
  const [invitationsOpen, setInvitationsOpen] = useState(false)
  const isOwner = event?.owner_id === userId
  const usesPin = event?.guest_access_mode === 'pin'
  const ownedParticipantIds = new Set(
    participants
      .filter((participant) => participant.user_id === userId)
      .map((participant) => participant.id),
  )
  const myProfiles = participants.filter(
    (participant) =>
      participant.user_id === userId || ownedParticipantIds.has(participant.guardian_id ?? ''),
  )
  const selectedProfile = myProfiles.find((p) => p.id === activeProfileId) ?? myProfiles[0]
  const myProfileIds = myProfiles.map((p) => p.id).join(',')
  const assignmentKey =
    selectedProfile && event?.drawn_at ? `${event.drawn_at}:${selectedProfile.id}` : ''
  const assignment = storedAssignment?.key === assignmentKey ? storedAssignment.value : null
  const selectedInviteToken = selectedInvitation?.token ?? null
  const profileRevealed = Boolean(
    selectedProfile &&
    profileState?.drawn_at === event?.drawn_at &&
    profileState?.profiles.some((p) => p.id === selectedProfile.id && p.revealed),
  )
  function applyDashboardData([result, state]: Awaited<ReturnType<typeof loadDashboard>>) {
    setEvent(result.event)
    setParticipants(result.participants)
    setProfileState(state)
  }
  async function refresh() {
    setError('')
    resultCache.current.clear()
    try {
      applyDashboardData(await loadDashboard(id))
      setResultRevision((value) => value + 1)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let stopped = false
    setLoading(true)
    loadDashboard(id)
      .then((data) => {
        if (!stopped) applyDashboardData(data)
      })
      .catch((e) => {
        if (!stopped) setError(friendlyError(e))
      })
      .finally(() => {
        if (!stopped) setLoading(false)
      })
    return () => {
      stopped = true
    }
  }, [id, userId])
  useEffect(() => {
    resultCache.current.clear()
  }, [event?.drawn_at])
  useEffect(() => {
    let stopped = false
    setStoredAssignment(null)
    const profileId = selectedProfile?.id
    const drawnAt = event?.drawn_at
    if (!profileId || !drawnAt) {
      setResultLoading(false)
      return
    }
    const key = `${drawnAt}:${profileId}`
    const cached = resultCache.current.get(key)
    if (cached) {
      setStoredAssignment({ key, value: cached })
      setResultLoading(false)
      return
    }
    if (!profileRevealed) {
      setResultLoading(false)
      return
    }
    setResultLoading(true)
    rpc<Assignment | null>('restore_my_assignment', {
      p_participant_id: profileId,
      p_expected_drawn_at: drawnAt,
    })
      .then((data) => {
        if (stopped) return
        if (data) {
          resultCache.current.set(key, data)
          setStoredAssignment({ key, value: data })
        } else {
          setProfileState(null)
          void refresh()
        }
      })
      .catch((e) => {
        if (!stopped) setError(friendlyError(e))
      })
      .finally(() => {
        if (!stopped) setResultLoading(false)
      })
    return () => {
      stopped = true
    }
  }, [selectedProfile?.id, event?.drawn_at, profileRevealed, resultRevision])
  function rememberAssignment(data: Assignment) {
    const key = `${event?.drawn_at}:${data.participant_id}`
    resultCache.current.set(key, data)
    setStoredAssignment({ key, value: data })
    setProfileState((current) =>
      current
        ? {
            ...current,
            profiles: current.profiles.map((p) =>
              p.id === data.participant_id ? { ...p, revealed: true } : p,
            ),
          }
        : current,
    )
  }
  useEffect(() => {
    if (selectedProfile) {
      setWishes([0, 1, 2].map((i) => selectedProfile.wishes?.[i] ?? ''))
      setExtra(selectedProfile.extra ?? '')
    }
  }, [selectedProfile?.id, myProfileIds])
  async function runAction(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  async function showInvitations() {
    await runAction(async () => {
      const data = await rpc<Invitation[]>('get_participant_invites', { p_event_id: id })
      setInvitations(data)
      setInvitationsOpen(true)
    })
  }
  async function copyInvitation(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      onToast('Enlace copiado')
    } catch {
      setError('No se pudo copiar. Mantén presionado el enlace para seleccionarlo.')
    }
  }
  async function shareInvitation(text: string, name: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Intercambio · ${event?.title}`,
          text: `${name}, esta es tu invitación personal.`,
          url: text,
        })
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) await copyInvitation(text)
      }
    } else await copyInvitation(text)
  }
  async function confirmPendingAction() {
    if (
      !pendingAction ||
      !event ||
      busy ||
      (pendingAction === 'delete' && deleteConfirmation !== 'ELIMINAR')
    )
      return
    const type = pendingAction
    await runAction(async () => {
      if (type === 'delete') {
        await rpc('delete_event', { p_event_id: id, p_confirmation: deleteConfirmation })
        setPendingAction(null)
        onToast('Evento eliminado definitivamente')
        onBack()
        return
      }
      if (type === 'archive')
        await rpc('archive_event', { p_event_id: id, p_archived: event.status !== 'archived' })
      else
        await rpc('draw_event', {
          p_event_id: id,
          p_expected_drawn_at: type === 'redraw' ? event.drawn_at : null,
        })
      setPendingAction(null)
      setStoredAssignment(null)
      await refresh()
      onToast(type === 'archive' ? 'Evento actualizado' : '¡Sorteo listo!')
    })
  }
  if (loading)
    return (
      <div className="flex justify-center py-20" role="status" aria-label="Cargando evento">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  if (!event)
    return (
      <>
        <button className="btn-text" onClick={onBack}>
          <ArrowLeft size={17} />
          Volver
        </button>
        <p role="alert" className="py-10 text-center text-sm text-gray-500">
          {error || 'Evento no encontrado.'}
        </p>
      </>
    )
  if (editing)
    return (
      <EventForm
        event={event}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          void refresh()
          onToast('Evento actualizado')
        }}
      />
    )
  return (
    <section className="screen">
      <div className="mb-5 flex items-center justify-between">
        <button className="btn-text -ml-3" onClick={onBack}>
          <ArrowLeft size={17} />
          Mis eventos
        </button>
        <button
          className="icon-button"
          aria-label="Actualizar evento"
          disabled={busy}
          onClick={() => void runAction(refresh)}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <h1 className="heading break-words">{event.title}</h1>
      <EventMetadata event={event} />
      <div className="my-5 flex items-center justify-center gap-2 text-xs text-gray-400">
        <span
          className={`size-1.5 rounded-full ${event.status === 'drawn' ? 'bg-emerald-500' : event.status === 'draft' ? 'bg-amber-400' : 'bg-gray-400'}`}
        />
        {event.status === 'draft'
          ? 'Listo para organizar'
          : event.status === 'drawn'
            ? 'Sorteo realizado'
            : 'Evento archivado'}
        {isOwner && (
          <>
            <span>·</span>
            <span>Eres el organizador</span>
          </>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {isOwner && (
        <div className="space-y-3">
          <p className="text-center text-xs text-gray-400">
            {usesPin ? 'Invitados con NIP · sin cuenta' : 'Invitados con cuenta de usuario'}
          </p>
          {event.status !== 'archived' && (
            <button
              className="btn-primary"
              onClick={() => setPendingAction(event.status === 'drawn' ? 'redraw' : 'draw')}
              disabled={busy}
            >
              <Shuffle size={18} />
              {event.status === 'drawn' ? 'Volver a sortear' : 'Generar sorteo'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-secondary"
              disabled={busy || event.status === 'archived'}
              onClick={() => void showInvitations()}
            >
              <LinkIcon size={16} />
              Invitaciones
            </button>
            <button
              className="btn-secondary"
              disabled={busy || event.status === 'archived'}
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} />
              Editar evento
            </button>
          </div>
          <div className="pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Users size={16} />
                Participantes <span className="text-gray-400">{participants.length}</span>
              </h2>
              {event.status === 'draft' && (
                <button
                  className="btn-text !min-h-8 !text-xs"
                  onClick={() => setParticipantFormOpen(true)}
                >
                  <Plus size={14} />
                  Agregar
                </button>
              )}
            </div>
            <div className="space-y-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-3 dark:border-gray-900"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold dark:bg-gray-900">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {p.is_child
                          ? `Dependiente · ${participants.find((g) => g.id === p.guardian_id)?.name ?? 'adulto responsable'}`
                          : p.user_id === userId
                            ? 'Tu perfil'
                            : usesPin
                              ? 'Acceso con NIP'
                              : p.user_id
                                ? 'Cuenta vinculada'
                                : 'Registro pendiente'}
                      </p>
                    </div>
                  </div>
                  {event.status === 'draft' && (
                    <button
                      className="icon-button !size-8 hover:!text-red-500"
                      aria-label={`Quitar a ${p.name}`}
                      disabled={busy}
                      onClick={() =>
                        void runAction(async () => {
                          await rpc('remove_participant', { p_participant_id: p.id })
                          await refresh()
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {event.status === 'drawn' && (
              <p className="mt-3 text-xs leading-relaxed text-gray-400">
                Los participantes quedan fijos después del sorteo para conservar sus resultados.
              </p>
            )}
          </div>
        </div>
      )}
      {myProfiles.length > 0 && (
        <div className="mt-8 border-t border-gray-100 pt-6 dark:border-gray-900">
          {myProfiles.length > 1 && (
            <>
              <label htmlFor="profile" className="label !mt-0">
                Viendo perfil de
              </label>
              <select
                id="profile"
                className="field mb-5"
                disabled={busy}
                value={selectedProfile?.id ?? ''}
                onChange={(e) => setActiveProfileId(e.target.value)}
              >
                {myProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_child ? ' · Dependiente' : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          <h2 className="mb-4 text-lg font-bold tracking-tight">
            Tu resultado
            {myProfiles.length === 1 ? (
              <span className="float-right mt-1 text-xs font-medium text-gray-400">
                {selectedProfile?.name}
              </span>
            ) : null}
          </h2>
          {event.drawn_at ? (
            <div className="relative overflow-hidden rounded-2xl bg-gray-900 p-6 text-white">
              {resultLoading ? (
                <div
                  className="flex min-h-48 items-center justify-center gap-2 text-sm"
                  role="status"
                >
                  <LoaderCircle size={20} className="animate-spin" />
                  Cargando tu resultado…
                </div>
              ) : !assignment ? (
                <button
                  className="flex min-h-48 w-full flex-col items-center justify-center gap-4 rounded-xl focus-visible:!outline-white"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const data = await rpc<Assignment>('get_my_assignment', {
                        p_participant_id: selectedProfile.id,
                      })
                      if (!data) throw new Error('El sorteo todavía no está listo.')
                      rememberAssignment(data)
                      celebrateReveal()
                    })
                  }
                >
                  <Gift size={45} strokeWidth={1.4} />
                  <span className="text-xs font-bold tracking-widest">
                    {busy ? 'CARGANDO…' : 'TOCA PARA REVELAR'}
                  </span>
                  <span className="text-xs text-gray-400">Tu amigo secreto te espera</span>
                </button>
              ) : (
                <>
                  <AssignmentDetails assignment={assignment} />
                  <button
                    className="mt-5 text-xs text-gray-400 underline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const data = await rpc<Assignment | null>('restore_my_assignment', {
                          p_participant_id: selectedProfile.id,
                          p_expected_drawn_at: event.drawn_at,
                        })
                        if (data) rememberAssignment(data)
                        else {
                          setStoredAssignment(null)
                          await refresh()
                        }
                      })
                    }
                  >
                    Actualizar preferencias
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="panel text-center">
              <Gift className="mx-auto mb-3 text-gray-400" size={28} />
              <p className="text-sm text-gray-500">El organizador aún no realiza el sorteo.</p>
              <p className="mt-1 text-xs text-gray-400">
                Mientras tanto, completa tus preferencias.
              </p>
            </div>
          )}
          <form
            className="mt-7"
            key={selectedProfile?.id}
            onSubmit={(e) => {
              e.preventDefault()
              void runAction(async () => {
                await rpc('save_wishes', {
                  p_participant_id: selectedProfile.id,
                  p_wishes: wishes,
                  p_extra: extra,
                })
                setParticipants((current) =>
                  current.map((p) =>
                    p.id === selectedProfile.id ? { ...p, wishes: [...wishes], extra } : p,
                  ),
                )
                onToast('Preferencias guardadas')
              })
            }}
          >
            <h2 className="text-lg font-bold tracking-tight">Llena el perfil</h2>
            <p className="mt-1 text-sm text-gray-500">Ayuda a tu amigo secreto.</p>
            <GiftPreferencesFields
              wishes={wishes}
              extra={extra}
              giftType={event.gift_type}
              onWishChange={(index, value) =>
                setWishes(wishes.map((wish, position) => (position === index ? value : wish)))
              }
              onExtraChange={setExtra}
            />
            <button className="btn-primary mt-5" disabled={busy || event.status === 'archived'}>
              {busy && <LoaderCircle className="animate-spin" size={17} />}Guardar preferencias
            </button>
          </form>
        </div>
      )}
      {isOwner && (
        <div className="mt-7 space-y-1 border-t border-gray-100 pt-4 dark:border-gray-900">
          <button
            className="btn-text mx-auto !text-xs"
            disabled={busy}
            onClick={() => setPendingAction('archive')}
          >
            {event.status === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}{' '}
            {event.status === 'archived' ? 'Restaurar evento' : 'Archivar evento'}
          </button>
          <button
            className="btn-text mx-auto !text-xs !text-red-600 dark:!text-red-400"
            disabled={busy}
            onClick={() => {
              setDeleteConfirmation('')
              setPendingAction('delete')
            }}
          >
            <Trash2 size={14} />
            Eliminar definitivamente
          </button>
        </div>
      )}
      {pendingAction && (
        <Modal
          title={
            pendingAction === 'delete'
              ? '¿Eliminar este evento?'
              : pendingAction === 'archive'
                ? event.status === 'archived'
                  ? '¿Restaurar evento?'
                  : '¿Archivar evento?'
                : pendingAction === 'redraw'
                  ? '¿Reasignar sorteo?'
                  : '¿Realizar el sorteo?'
          }
          onClose={() => {
            if (!busy) setPendingAction(null)
          }}
        >
          <p className="text-sm leading-relaxed text-gray-500">
            {pendingAction === 'delete'
              ? `Se borrará “${event.title}” junto con sus participantes, preferencias, NIP y sorteo. Sus invitaciones dejarán de funcionar. Esta acción no se puede deshacer.`
              : pendingAction === 'archive'
                ? event.status === 'archived'
                  ? 'Volverá a aparecer entre tus eventos activos.'
                  : 'El evento y sus datos se conservarán. Podrás restaurarlo desde tus eventos archivados.'
                : pendingAction === 'redraw'
                  ? 'Se reemplazarán todos los resultados anteriores. Avísales a tus invitados que deben volver a consultar su resultado.'
                  : 'Cada persona recibirá un amigo secreto. Después no podrás agregar ni quitar participantes.'}
          </p>
          {pendingAction === 'delete' && (
            <>
              <label className="label" htmlFor="delete-event-confirmation">
                Escribe ELIMINAR para confirmar
              </label>
              <input
                id="delete-event-confirmation"
                className="field"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
              />
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            className={
              pendingAction === 'delete'
                ? 'btn-primary mt-6 !bg-red-600 !text-white hover:!bg-red-700'
                : 'btn-primary mt-6'
            }
            disabled={busy || (pendingAction === 'delete' && deleteConfirmation !== 'ELIMINAR')}
            onClick={() => void confirmPendingAction()}
          >
            {busy && <LoaderCircle size={16} className="animate-spin" />}
            {pendingAction === 'delete' ? 'Eliminar definitivamente' : 'Confirmar'}
          </button>
          <button
            className="btn-text mx-auto mt-2"
            disabled={busy}
            onClick={() => setPendingAction(null)}
          >
            Cancelar
          </button>
        </Modal>
      )}
      {invitationsOpen && (
        <Modal
          title={invitationToReset ? '¿Restablecer su NIP?' : 'Invitaciones personales'}
          onClose={() => {
            if (!busy) {
              setInvitationsOpen(false)
              setSelectedInvitation(null)
              setInvitationToReset(null)
            }
          }}
        >
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
          {invitationToReset ? (
            <>
              <p className="text-sm leading-relaxed text-gray-500">
                {invitationToReset.name} tendrá que crear un NIP nuevo desde su invitación. Se
                cerrarán sus sesiones de invitado y se conservarán sus preferencias y resultado.
              </p>
              <button
                className="btn-primary mt-6"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    const selected = invitationToReset
                    await rpc('reset_pin', { p_participant_id: selected.participant_id })
                    const updated = { ...selected, has_pin: false, claimed: false }
                    setInvitations((current) =>
                      current.map((item) =>
                        item.participant_id === selected.participant_id ? updated : item,
                      ),
                    )
                    setSelectedInvitation(updated)
                    setInvitationToReset(null)
                    onToast('NIP restablecido. Ya puede crear uno nuevo.')
                  })
                }
              >
                {busy && <LoaderCircle size={16} className="animate-spin" />}Restablecer NIP
              </button>
              <button
                className="btn-text mx-auto mt-2"
                disabled={busy}
                onClick={() => setInvitationToReset(null)}
              >
                Cancelar
              </button>
            </>
          ) : selectedInvitation && selectedInviteToken ? (
            <>
              <button
                className="btn-text -ml-3 mb-3"
                disabled={busy}
                onClick={() => setSelectedInvitation(null)}
              >
                <ArrowLeft size={15} />
                Ver participantes
              </button>
              <p className="text-center text-sm font-semibold">
                Invitación de {selectedInvitation.name}
              </p>
              <div className="mx-auto my-5 w-fit rounded-xl bg-white p-3">
                <QRCodeSVG value={invitationUrl(selectedInviteToken)} size={176} />
              </div>
              <p className="mb-4 text-center text-xs leading-relaxed text-gray-500">
                Compártela sólo con {selectedInvitation.name}.{' '}
                {usesPin
                  ? 'Al abrirla podrá crear su NIP de seis dígitos y entrar sin una cuenta.'
                  : 'Al abrirla deberá registrarse o iniciar sesión para vincular su perfil.'}
              </p>
              <div className="panel mb-4 break-all select-all text-xs">
                {invitationUrl(selectedInviteToken)}
              </div>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  void shareInvitation(invitationUrl(selectedInviteToken), selectedInvitation.name)
                }
              >
                <Share2 size={17} />
                Compartir invitación
              </button>
              <button
                className="btn-text mx-auto mt-2"
                disabled={busy}
                onClick={() => void copyInvitation(invitationUrl(selectedInviteToken))}
              >
                <Copy size={15} />
                Copiar enlace
              </button>
              {usesPin && selectedInvitation.has_pin && (
                <button
                  className="btn-secondary mt-4"
                  disabled={busy}
                  onClick={() => setInvitationToReset(selectedInvitation)}
                >
                  <KeyRound size={16} />
                  Restablecer NIP
                </button>
              )}
            </>
          ) : (
            <>
              <p className="mb-4 text-sm leading-relaxed text-gray-500">
                {usesPin
                  ? 'Cada adulto entra con su enlace y NIP, sin crear una cuenta.'
                  : 'Cada adulto entra con su enlace y una cuenta de usuario.'}{' '}
                Sus dependientes usarán el mismo acceso.
              </p>
              {myProfiles.length === 0 && (
                <p className="mb-4 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-900">
                  Si también participas, abre tu propia invitación{' '}
                  {usesPin ? 'y crea tu NIP.' : 'para vincular tu perfil con tu cuenta.'}
                </p>
              )}
              <div className="space-y-2">
                {invitations.map((item) => (
                  <button
                    key={item.participant_id}
                    disabled={!item.token || busy}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 p-3 text-left dark:border-gray-800"
                    onClick={() => {
                      if (item.token) setSelectedInvitation(item)
                    }}
                  >
                    <span className="truncate text-sm font-semibold">{item.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
                      {usesPin ? (
                        item.has_pin ? (
                          <>
                            <CheckCircle2 size={14} />
                            NIP creado
                          </>
                        ) : (
                          'Compartir'
                        )
                      ) : item.account_linked ? (
                        <>
                          <CheckCircle2 size={14} />
                          Cuenta vinculada
                        </>
                      ) : (
                        'Compartir'
                      )}
                      <ChevronRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
      {participantFormOpen && (
        <Modal title="Agregar participante" onClose={() => setParticipantFormOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void runAction(async () => {
                await rpc('add_participant', {
                  p_event_id: id,
                  p_name: newParticipantName.trim(),
                  p_is_child: newParticipantIsChild,
                  p_guardian_id: newParticipantIsChild ? newParticipantGuardianId : null,
                })
                setParticipantFormOpen(false)
                setNewParticipantName('')
                setNewParticipantIsChild(false)
                setNewParticipantGuardianId('')
                await refresh()
              })
            }}
          >
            <label htmlFor="new-name" className="label !mt-0">
              Nombre
            </label>
            <input
              id="new-name"
              className="field"
              required
              maxLength={80}
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
            />
            <label className="mt-3 flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={newParticipantIsChild}
                onChange={(e) => setNewParticipantIsChild(e.target.checked)}
              />
              Dependiente
            </label>
            {newParticipantIsChild && (
              <select
                className="field mt-3"
                aria-label="Adulto responsable"
                required
                value={newParticipantGuardianId}
                onChange={(e) => setNewParticipantGuardianId(e.target.value)}
              >
                <option value="">Selecciona un adulto</option>
                {participants
                  .filter((p) => !p.is_child)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
            {error && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button className="btn-primary mt-5" disabled={busy}>
              Agregar
            </button>
          </form>
        </Modal>
      )}
    </section>
  )
}
