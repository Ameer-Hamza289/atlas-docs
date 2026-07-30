const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000]
]

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function formatRelativeTime(isoDate: string): string {
  const timestamp = Date.parse(isoDate)
  if (Number.isNaN(timestamp)) return ''

  const delta = timestamp - Date.now()
  const magnitude = Math.abs(delta)

  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) return relative.format(Math.round(delta / ms), unit)
  }

  return 'just now'
}
