import { ExternalLink } from 'lucide-react'

interface Props {
  label: string
}

export default function ComingSoonPage({ label }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 p-8">
      <div className="rounded-2xl border border-border bg-panel p-8 text-center max-w-sm w-full">
        <div className="mb-3 text-3xl">🚧</div>
        <h2 className="mb-2 text-lg font-semibold text-text">{label}</h2>
        <p className="mb-5 text-sm text-dim">
          This page is being built as part of the full-site consolidation.
          Use the legacy dashboard in the meantime.
        </p>
        <a
          href="/legacy"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 border border-brand/20
                     px-4 py-2 text-sm font-medium text-brand hover:bg-brand/15 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open legacy dashboard
        </a>
      </div>
    </div>
  )
}
