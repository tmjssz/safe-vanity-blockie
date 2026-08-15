import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive [&>svg]:text-current',
        // A standing caution, not an error. Amber rather than the destructive red because nothing
        // has gone wrong when one of these is on screen, and a permanent red panel on a working
        // screen is the fastest way to teach someone to stop seeing it. Both palettes are written
        // out rather than left to a `dark:` inversion of one, so each is deliberate. Lives here
        // rather than as classes at the call site because two places show the same warning and
        // they have to stay recognisably the same warning.
        warning:
          'border-amber-500/30 bg-amber-500/5 text-amber-900 *:data-[slot=alert-description]:text-amber-900/80 [&_strong]:text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/5 dark:text-amber-100 dark:*:data-[slot=alert-description]:text-amber-100/70 dark:[&_strong]:text-amber-100',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
