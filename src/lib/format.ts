const pad = (n: number) => String(n).padStart(2, '0')

/** 3725000 -> "1:02:05", 65000 -> "01:05" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Seconds per km -> "5:30", or "--:--" when unknown. */
export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '--:--'
  // Anything slower than 60 min/km is walking-pace noise, not a run
  if (secPerKm >= 3600) return '--:--'
  const total = Math.round(secPerKm)
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** Metres -> "2.35" (km, two decimals). */
export function formatDistanceKm(meters: number): string {
  return (meters / 1000).toFixed(2)
}

/** Epoch ms -> "Mon 26 Oct" in the phone's time zone. */
export function formatRunDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** Epoch ms -> "07:12" (24 h) in the phone's time zone. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
