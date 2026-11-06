import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: 'bg-brand-mist text-ink-soft', dot: 'bg-ink-mute' },
  info: { box: 'bg-brand-mist text-brand-blue', dot: 'bg-brand-sky' },
  success: { box: 'bg-success-soft text-success', dot: 'bg-success' },
  warning: { box: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  danger: { box: 'bg-danger-soft text-danger', dot: 'bg-danger' },
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Shows a leading status dot. Colour is never the only signal: the label always carries the meaning. */
  dot?: boolean
}

export function Badge({ tone = 'neutral', dot = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label',
        tones[tone].box,
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('size-1.5 rounded-full', tones[tone].dot)} aria-hidden />}
      {children}
    </span>
  )
}

export type StatusKind = 'active' | 'pending' | 'success' | 'unfunded' | 'depleted' | 'unknown' | 'expired' | 'revoked' | 'failed'

const statusMap: Record<StatusKind, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  unfunded: { label: 'Unfunded', tone: 'warning' },
  depleted: { label: 'No funds', tone: 'neutral' },
  unknown: { label: 'Verify status', tone: 'warning' },
  pending: { label: 'Pending', tone: 'warning' },
  success: { label: 'Confirmed', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
}

/** Lease and transaction status with consistent wording and colour. */
export function StatusBadge({ status, className }: { status: StatusKind; className?: string }) {
  const { label, tone } = statusMap[status]
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  )
}
