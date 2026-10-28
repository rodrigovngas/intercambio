import { useState, type SubmitEvent } from 'react'
import { ArrowLeft, Plus, Trash2, LoaderCircle, UserRound, Baby } from 'lucide-react'
import { formatDate, friendlyError, rpc, validateParticipants } from '../lib/api'
import type { ExchangeEvent, DraftParticipant } from '../lib/api'
type EventFormProps = {
  event?: ExchangeEvent
  onSaved: (id: string) => void
  onCancel: () => void
  canUsePin?: boolean
}

const budgetOptions = ['Libre', ...Array.from({ length: 19 }, (_, index) => `$${(index + 2) * 50}`)]

export function EventForm({ event, onSaved, onCancel, canUsePin = false }: EventFormProps) {
  const [title, setTitle] = useState(event?.title ?? '')
  const [eventDate, setEventDate] = useState(event?.event_date ?? '')
  const [budget, setBudget] = useState(event?.budget ?? 'Libre')
  const [giftType, setGiftType] = useState(event?.gift_type ?? '')
  const [participants, setParticipants] = useState<DraftParticipant[]>([])
  const [participantName, setParticipantName] = useState('')
  const [isChild, setIsChild] = useState(false)
  const [selectedGuardianIndex, setSelectedGuardianIndex] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accessMode, setAccessMode] = useState<'account' | 'pin'>(canUsePin ? 'pin' : 'account')
  function addParticipant() {
    if (participants.length >= 100) {
      setError('El límite es de 100 participantes por evento.')
      return
    }
    const participant = {
      name: participantName.trim(),
      is_child: isChild,
      ...(isChild ? { guardian_index: Number(selectedGuardianIndex) } : {}),
    }
    if (!participant.name) return
    if (isChild && selectedGuardianIndex === '') {
      setError('Selecciona un adulto responsable.')
      return
    }
    if (
      participants.some(
        (existing) =>
          existing.name.toLocaleLowerCase('es-MX') === participant.name.toLocaleLowerCase('es-MX'),
      )
    ) {
      setError('Ese nombre ya está en la lista.')
      return
    }
    setParticipants([...participants, participant])
    setParticipantName('')
    setIsChild(false)
    setSelectedGuardianIndex('')
    setError('')
  }
  function removeParticipant(index: number) {
    const removedIndexes = new Set([
      index,
      ...participants.flatMap((participant, position) =>
        participant.guardian_index === index ? [position] : [],
      ),
    ])
    const removedPositions = [...removedIndexes]
    setParticipants(
      participants
        .filter((_, position) => !removedIndexes.has(position))
        .map((participant) => {
          const guardianIndex = participant.guardian_index
          return {
            ...participant,
            ...(guardianIndex !== undefined
              ? {
                  guardian_index:
                    guardianIndex -
                    removedPositions.filter((position) => position < guardianIndex).length,
                }
              : {}),
          }
        }),
    )
    setSelectedGuardianIndex('')
  }
  async function submitEvent(submit: SubmitEvent<HTMLFormElement>) {
    submit.preventDefault()
    setError('')
    if (busy) return
    if (!title.trim()) {
      setError('Escribe el título del evento.')
      return
    }
    const validation = event ? null : validateParticipants(participants)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    try {
      const details = {
        p_title: title.trim(),
        p_event_date: eventDate,
        p_budget: budget,
        p_gift_type: giftType.trim(),
      }
      let savedEventId: string
      if (event) {
        await rpc('update_event', { ...details, p_event_id: event.id })
        savedEventId = event.id
      } else {
        savedEventId = await rpc<string>('create_event_with_access', {
          ...details,
          p_participants: participants,
          p_guest_access_mode: canUsePin ? accessMode : 'account',
        })
      }
      onSaved(savedEventId)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="screen">
      <button className="btn-text -ml-3 mb-3" onClick={onCancel}>
        <ArrowLeft size={17} />
        Volver
      </button>
      <h1 className="heading">{event ? 'Editar evento' : 'Configurar evento'}</h1>
      <p className="subheading">
        {event ? 'Ajusta los detalles de tu intercambio.' : 'Los buenos regalos empiezan aquí.'}
      </p>
      <form onSubmit={submitEvent}>
        <label className="label" htmlFor="event-title">
          Título del evento
        </label>
        <input
          id="event-title"
          className="field"
          required
          maxLength={100}
          placeholder="Ej. Cena de Navidad"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="label" htmlFor="event-date">
          Fecha
        </label>
        <input
          id="event-date"
          type="date"
          className="field"
          required
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="budget">
              Presupuesto
            </label>
            <select
              id="budget"
              className="field"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            >
              {budgetOptions.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="gift">
              ¿Qué se regala?
            </label>
            <input
              id="gift"
              className="field"
              maxLength={80}
              placeholder="Ej. Pijamas"
              value={giftType}
              onChange={(e) => setGiftType(e.target.value)}
            />
          </div>
        </div>
        {!event && (
          <>
            {canUsePin ? (
              <>
                <label className="label" htmlFor="guest-access">
                  Acceso de tus invitados
                </label>
                <select
                  id="guest-access"
                  className="field"
                  value={accessMode}
                  onChange={(e) => setAccessMode(e.target.value as 'account' | 'pin')}
                >
                  <option value="pin">NIP · sin crear cuenta</option>
                  <option value="account">Cuenta de usuario</option>
                </select>
                <p className="mt-2 text-xs leading-relaxed text-gray-400">
                  Tu cuenta permite invitar con NIP. Puedes elegir que este evento requiera una
                  cuenta.
                </p>
              </>
            ) : (
              <p className="panel mt-5 text-xs leading-relaxed text-gray-500">
                Tus invitados necesitarán registrarse o iniciar sesión para entrar al evento.
              </p>
            )}
            <label className="label" htmlFor="participant-name">
              Participantes <span className="float-right">{participants.length}/100</span>
            </label>
            <div className="flex gap-2">
              <input
                id="participant-name"
                className="field"
                placeholder="Nombre…"
                maxLength={80}
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addParticipant()
                  }
                }}
              />
              <button
                type="button"
                aria-label="Agregar participante"
                className="btn-primary !w-13 !shrink-0 !px-0"
                disabled={participants.length >= 100}
                onClick={addParticipant}
              >
                <Plus size={21} />
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-500">
              <input
                type="checkbox"
                className="size-4 accent-gray-900"
                checked={isChild}
                onChange={(e) => setIsChild(e.target.checked)}
              />
              Dependiente
            </label>
            {isChild && (
              <select
                aria-label="Adulto responsable"
                className="field mt-3"
                value={selectedGuardianIndex}
                onChange={(e) => setSelectedGuardianIndex(e.target.value)}
              >
                <option value="">Selecciona su adulto responsable</option>
                {participants.map(
                  (p, i) =>
                    !p.is_child && (
                      <option key={i} value={i}>
                        {p.name}
                      </option>
                    ),
                )}
              </select>
            )}
            <div className="mt-4 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-dashed border-gray-200 p-2 dark:border-gray-800">
              {participants.length === 0 ? (
                <p className="py-5 text-center text-xs text-gray-400">Agrega al menos 2 personas</p>
              ) : (
                participants.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {p.is_child ? <Baby size={16} /> : <UserRound size={16} />}
                      <span className="truncate text-sm font-semibold">{p.name}</span>
                      {p.is_child && (
                        <span className="text-[10px] text-gray-400">
                          con {participants[p.guardian_index!]?.name}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-button !size-8 hover:!text-red-500"
                      aria-label={`Quitar a ${p.name}`}
                      onClick={() => removeParticipant(i)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              Crearás un borrador. Podrás compartir las invitaciones y hacer el sorteo cuando todo
              esté listo.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button className="btn-primary mt-7" disabled={busy}>
          {busy ? <LoaderCircle size={19} className="animate-spin" /> : <Plus size={18} />}{' '}
          {event ? 'Guardar cambios' : 'Crear evento'}
        </button>
        {event && (
          <p className="mt-3 text-center text-xs text-gray-400">
            Fecha actual: {formatDate(event.event_date)}
          </p>
        )}
        <button type="button" onClick={onCancel} className="btn-text mx-auto mt-2">
          Cancelar
        </button>
      </form>
    </section>
  )
}
