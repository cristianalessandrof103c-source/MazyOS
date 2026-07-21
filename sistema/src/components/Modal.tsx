import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-md',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className={`card w-full ${maxWidth} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
