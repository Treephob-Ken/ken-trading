import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface BentoItem {
  title: string
  description: string
  icon: ReactNode
  /** Small badge shown top-right of the icon area (e.g. "Live", "v2.4") */
  status?: string
  /** Hashtag chips shown at the bottom */
  tags?: string[]
  /** Dimmer meta string appended to title */
  meta?: string
  /** CTA label shown on hover (defaults to "Explore →") */
  cta?: string
  /** 1 or 2 (md:col-span-2) */
  colSpan?: 1 | 2
  /** If true the hover state is always active */
  hasPersistentHover?: boolean
}

interface BentoGridProps {
  items: BentoItem[]
  className?: string
}

// ── Component ────────────────────────────────────────────────────────────────

function BentoCell({ item }: { item: BentoItem }) {
  const active = item.hasPersistentHover

  return (
    <div
      className={cn(
        'group relative p-4 rounded-xl overflow-hidden transition-all duration-300 cursor-default',
        'border border-border bg-panel',
        'hover:shadow-[0_4px_24px_rgba(0,0,0,0.55)]',
        'hover:-translate-y-0.5 will-change-transform',
        item.colSpan === 2 && 'md:col-span-2',
        active && '-translate-y-0.5 shadow-[0_4px_24px_rgba(0,0,0,0.55)]',
      )}
    >
      {/* Dot-grid overlay */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300 pointer-events-none',
          'bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.025)_1px,transparent_1px)]',
          'bg-[length:12px_12px]',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      />

      {/* Gradient border shine */}
      <div
        className={cn(
          'absolute inset-0 -z-10 rounded-xl p-px pointer-events-none',
          'bg-gradient-to-br from-transparent via-white/[0.06] to-transparent',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          'transition-opacity duration-300',
        )}
      />

      {/* Content */}
      <div className="relative flex flex-col gap-3">
        {/* Top row: icon + status badge */}
        <div className="flex items-center justify-between">
          <div
            className={cn(
              'h-8 w-8 rounded-lg flex items-center justify-center',
              'bg-white/[0.06] transition-all duration-300',
              'group-hover:bg-white/[0.10]',
            )}
          >
            {item.icon}
          </div>
          {item.status && (
            <span
              className={cn(
                'text-[10px] font-semibold px-2 py-1 rounded-lg',
                'bg-white/[0.06] text-muted',
                'transition-colors duration-300 group-hover:bg-white/[0.10]',
              )}
            >
              {item.status}
            </span>
          )}
        </div>

        {/* Title + description */}
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-text tracking-tight leading-snug">
            {item.title}
            {item.meta && (
              <span className="ml-2 text-xs text-dim font-normal">{item.meta}</span>
            )}
          </h3>
          <p className="text-xs text-muted leading-snug">{item.description}</p>
        </div>

        {/* Tags + CTA */}
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {item.tags?.map((tag) => (
              <span
                key={tag}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-md',
                  'bg-white/[0.05] text-dim',
                  'transition-colors duration-200 group-hover:bg-white/[0.10]',
                )}
              >
                #{tag}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-dim opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            {item.cta ?? 'Explore →'}
          </span>
        </div>
      </div>
    </div>
  )
}

export function BentoGrid({ items, className }: BentoGridProps) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-3 gap-3', className)}>
      {items.map((item, i) => (
        <BentoCell key={i} item={item} />
      ))}
    </div>
  )
}
