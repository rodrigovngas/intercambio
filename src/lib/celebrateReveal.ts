import confetti from 'canvas-confetti'

export function celebrateReveal() {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void confetti({ particleCount: 90, spread: 65, origin: { y: 0.55 } })
  }
}
