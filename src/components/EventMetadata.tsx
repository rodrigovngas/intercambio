import { CalendarDays, Gift } from 'lucide-react'
import { formatDate } from '../lib/api'
import type { ExchangeEvent } from '../lib/api'

type EventMetadataProps = {
  event: Pick<ExchangeEvent, 'event_date' | 'budget' | 'gift_type'>
}

export function EventMetadata({ event }: EventMetadataProps) {
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      <span className="pill">
        <CalendarDays size={13} />
        {formatDate(event.event_date)}
      </span>
      <span className="pill">{event.budget}</span>
      {event.gift_type && (
        <span className="pill">
          <Gift size={13} />
          {event.gift_type}
        </span>
      )}
    </div>
  )
}
