import { useId, useState, type FormEvent } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { friendlyError, rpc } from '../lib/api'
import { Modal } from './Modal'

type AccountSettingsProps = {
  email: string
  onClose: () => void
  onDeleted: () => void | Promise<void>
}

const confirmationText = 'BORRAR CUENTA'

export function AccountSettings({ email, onClose, onDeleted }: AccountSettingsProps) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState('')
  const prefix = useId()

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || deleted || confirmation !== confirmationText) return
    setBusy(true)
    setError('')
    try {
      await rpc('delete_account', { p_confirmation: confirmation })
    } catch (caught) {
      setError(friendlyError(caught))
      setBusy(false)
      return
    }
    // The destructive request has succeeded. A later navigation/sign-out failure
    // must not offer to submit it again or claim the deletion itself failed.
    setDeleted(true)
    setConfirmation('')
    try {
      await onDeleted()
    } catch {
      setError('Tu acceso a Intercambio se eliminó, pero no pudimos actualizar la pantalla. Cierra esta ventana y vuelve al inicio.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Borrar cuenta de Intercambio" onClose={() => { if (!busy) onClose() }}>
    <div aria-busy={busy}>
      <p className="mb-5 break-all text-sm font-semibold text-gray-900 dark:text-white">{email}</p>
      {deleted ? <>
        <p role="status" className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">Tu acceso a Intercambio y los datos de tus eventos se eliminaron. Tu cuenta y datos de Stocka se conservaron.</p>
        {error && <p role="alert" className="mt-4 text-sm leading-relaxed text-red-700 dark:text-red-300">{error}</p>}
        <button type="button" className="btn-primary mt-6" disabled={busy} onClick={onClose}>Cerrar</button>
      </> : <>
        <p id={`${prefix}-scope`} className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">Se eliminarán tu acceso a Intercambio y los eventos que organizas, junto con sus participantes, preferencias y sorteos. En eventos de otras personas se desvinculará tu cuenta y se borrarán tus preferencias; esos eventos se conservarán. Tu identidad de inicio de sesión y los datos de Stocka se conservarán.</p>
        <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">Esta acción no se puede deshacer.</p>
        <form onSubmit={event => void removeAccount(event)} aria-describedby={`${prefix}-scope`}>
          <label htmlFor={`${prefix}-confirmation`} className="label">Escribe BORRAR CUENTA para confirmar</label>
          <input id={`${prefix}-confirmation`} className="field" type="text" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={confirmationText} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} required />
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          <button type="submit" disabled={busy || confirmation !== confirmationText} className="mt-6 flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500">{busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}{busy ? 'Eliminando acceso…' : 'Borrar mi cuenta de Intercambio'}</button>
          <button type="button" className="btn-text mx-auto mt-2" disabled={busy} onClick={onClose}>Cancelar</button>
        </form>
      </>}
    </div>
  </Modal>
}
