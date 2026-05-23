import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Card container — mirrors .card but as a composable React component. */
const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-border bg-panel/85 backdrop-blur-sm',
        'shadow-[0_4px_24px_rgba(0,0,0,0.35)] transition-all duration-300',
        'hover:border-border-strong/70',
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

/** Top section: padded header with a bottom divider. */
const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-1 px-5 pt-5 pb-4 border-b border-border',
        className,
      )}
      {...props}
    />
  ),
)
CardHeader.displayName = 'CardHeader'

/** Primary card title. */
const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'text-sm font-semibold leading-tight tracking-tight text-text',
        className,
      )}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

/** Subtle description line beneath the title. */
const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-dim leading-snug', className)} {...props} />
  ),
)
CardDescription.displayName = 'CardDescription'

/** Main card body — default p-5. */
const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 py-4', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

/** Bottom footer row with a top divider. */
const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 px-5 pb-5 pt-4 border-t border-border',
        className,
      )}
      {...props}
    />
  ),
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
