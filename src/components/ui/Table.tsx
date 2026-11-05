import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Skeleton, ErrorState, EmptyState } from './States'
import { StatusBadge, type StatusKind } from './Badge'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** The row's headline on mobile. Defaults to the first column. */
  primary?: boolean
  /** Hide on tablet (768-1023) to keep the table readable. Still shown on mobile cards and laptop+. */
  hideOnTablet?: boolean
  /** Let dense controls use the full card width on mobile instead of sharing a two-column detail row. */
  mobileFullWidth?: boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  caption: string
  loading?: boolean
  error?: ReactNode
  onRetry?: () => void
  empty?: ReactNode
  className?: string
}

/**
 * Real table from tablet up; stacked cards on mobile. Never relies on sideways scrolling at 360px.
 * Rows must come from live data. Loading, error and empty are handled here so callers cannot forget them.
 */
export function DataTable<T>({ columns, rows, getRowId, caption, loading, error, onRetry, empty, className }: DataTableProps<T>) {
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const secondary = columns.filter((c) => c !== primary)

  if (error) return <ErrorState title="Could not load data" message={error} onRetry={onRetry} />
  if (loading) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label={`Loading ${caption}`}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState icon={Inbox} title="Nothing here yet" />}</>
  }

  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden", className)}>
      {/* Tablet and up */}
      <div className="hidden min-w-0 max-w-full overflow-hidden md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-brand-mist/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'break-words px-3 py-3 text-overline uppercase text-ink-soft lg:px-4',
                    c.align === 'right' && 'text-right',
                    c.hideOnTablet && 'hidden lg:table-cell',
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={getRowId(row)} className="transition-colors hover:bg-brand-mist/40">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'max-w-0 break-words px-3 py-3.5 align-middle text-body lg:px-4',
                      c.align === 'right' && 'text-right',
                      c.hideOnTablet && 'hidden lg:table-cell',
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={getRowId(row)} className="space-y-3 px-4 py-4">
            <div className="min-w-0 font-medium">{primary.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {secondary.map((c) => (
                <div key={c.key} className={cn('min-w-0', c.mobileFullWidth && 'col-span-2')}>
                  <dt className="text-overline uppercase text-ink-soft">{c.header}</dt>
                  <dd className="mt-0.5 min-w-0 break-words text-body">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface TransactionRowProps {
  title: string
  /** Counterparty or reference. Rendered truncated, in full via the title attribute. */
  subtitle?: string
  /** Pre-formatted amount from live data. */
  amount: string
  unit?: string
  direction?: 'out' | 'in'
  status?: StatusKind
  /** Pre-formatted time from live data. */
  time?: string
  /** Explorer link. Pass only for a real, submitted transaction. */
  explorerUrl?: string
}

/** One transaction line: stacked on mobile, single row from tablet up. */
export function TransactionRow({ title, subtitle, amount, unit = 'USDC', direction = 'out', status, time, explorerUrl }: TransactionRowProps) {
  const Icon = direction === 'out' ? ArrowUpRight : ArrowDownLeft
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:gap-4">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          direction === 'out' ? 'bg-brand-mist text-brand-blue' : 'bg-success-soft text-success',
        )}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{title}</p>
        <p className="flex min-w-0 items-center gap-2 text-support text-ink-soft">
          {subtitle && (
            <span className="truncate" title={subtitle}>
              {subtitle}
            </span>
          )}
          {time && <span className="shrink-0">{time}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 md:flex-row md:items-center md:gap-4">
        {status && <StatusBadge status={status} className="order-2 md:order-1" />}
        <p className="num order-1 text-body font-semibold text-ink md:order-2 md:min-w-28 md:text-right">
          {amount !== '—' && (direction === 'out' ? '−' : '+')}
          {amount}
          {amount !== '—' && <span className="font-normal text-ink-soft"> {unit}</span>}
        </p>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${title} on the explorer`}
            className="order-3 hidden size-9 items-center justify-center rounded-control text-ink-soft hover:bg-brand-mist hover:text-brand-blue md:flex"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </div>
    </li>
  )
}

export function TransactionList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {children}
    </ul>
  )
}
