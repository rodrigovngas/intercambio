export function SafeText({ text }: { text: string }) {
  return (
    <span className="break-words">
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
        /^https?:\/\//i.test(part) ? (
          <a
            key={index}
            href={part}
            className="underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  )
}
