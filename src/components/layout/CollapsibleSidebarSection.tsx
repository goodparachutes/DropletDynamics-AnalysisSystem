import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function CollapsibleSidebarSection({
  title,
  defaultOpen = true,
  className = '',
  children,
}: {
  title: string
  defaultOpen?: boolean
  /** 附加到 section，例如 overlay-display-panel */
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`panel control-panel ${className}`.trim()}>
      <div className="sidebar-collapsible-header">
        <button
          type="button"
          className="chart-collapse-toggle"
          aria-expanded={open}
          aria-label={open ? `收起「${title}」` : `展开「${title}」`}
          title={open ? '收起' : '展开'}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            size={18}
            className={`chart-collapse-chevron ${open ? '' : 'chart-collapse-chevron-folded'}`}
          />
        </button>
        <h3 className="panel-heading">{title}</h3>
      </div>
      {open && <div className="sidebar-collapsible-body">{children}</div>}
    </section>
  )
}
