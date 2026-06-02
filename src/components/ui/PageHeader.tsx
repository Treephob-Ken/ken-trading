import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

// One consistent page header across the app: brand icon + title + optional
// subtitle on the left, an actions slot (range tabs, refresh, etc.) on the right.
export default function PageHeader({ icon: Icon, title, subtitle, actions }: {
  icon?: LucideIcon
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 shrink-0 text-brand" />}
        <h1 className="text-lg font-semibold text-text font-display">{title}</h1>
        {subtitle && <p className="hidden sm:block text-xs text-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
