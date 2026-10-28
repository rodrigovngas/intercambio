type GiftPreferencesFieldsProps = {
  wishes: string[]
  extra: string
  giftType: string
  onWishChange: (index: number, value: string) => void
  onExtraChange: (value: string) => void
  idPrefix?: string
  inputsDisabled?: boolean
}

const wishPlaceholders = ['Ej. Libro de terror', 'Ej. Taza de Batman', 'Ej. Calcetas (o un enlace)']

export function GiftPreferencesFields({
  wishes,
  extra,
  giftType,
  onWishChange,
  onExtraChange,
  idPrefix = '',
  inputsDisabled,
}: GiftPreferencesFieldsProps) {
  return (
    <>
      {wishPlaceholders.map((placeholder, index) => (
        <div key={index}>
          <label className="label" htmlFor={`${idPrefix}wish-${index}`}>
            Opción {index + 1}
          </label>
          <input
            id={`${idPrefix}wish-${index}`}
            className="field"
            maxLength={500}
            placeholder={placeholder}
            disabled={inputsDisabled}
            value={wishes[index]}
            onChange={(change) => onWishChange(index, change.target.value)}
          />
        </div>
      ))}
      <label className="label" htmlFor={`${idPrefix}extra`}>
        {giftType ? `${giftType} · Información extra` : 'Información extra'}
      </label>
      <textarea
        id={`${idPrefix}extra`}
        className="field min-h-24 resize-y"
        maxLength={1000}
        placeholder="Talla, color favorito o alguna pista…"
        value={extra}
        disabled={inputsDisabled}
        onChange={(change) => onExtraChange(change.target.value)}
      />
    </>
  )
}
