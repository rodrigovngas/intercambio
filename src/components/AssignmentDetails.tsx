import type { Assignment } from '../lib/api'
import { SafeText } from './SafeText'

export function AssignmentDetails({ assignment }: { assignment: Assignment }) {
  const wishes = assignment.wishes?.filter(Boolean)
  return (
    <>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Te tocó regalar a</p>
      <h3 className="my-5 break-words text-4xl font-extrabold tracking-tight">
        {assignment.target_name}
      </h3>
      <div className="mt-6 border-t border-white/15 pt-4">
        <p className="mb-3 text-xs font-semibold text-gray-400">Sus opciones:</p>
        <ul className="space-y-3 text-sm">
          {wishes?.length ? (
            wishes.map((wish, index) => (
              <li key={index}>
                <SafeText text={wish} />
              </li>
            ))
          ) : (
            <li className="italic text-gray-400">Sin opciones aún.</li>
          )}
        </ul>
        {assignment.extra && (
          <p className="mt-4 border-t border-white/10 pt-4 text-sm">
            <SafeText text={assignment.extra} />
          </p>
        )}
      </div>
    </>
  )
}
