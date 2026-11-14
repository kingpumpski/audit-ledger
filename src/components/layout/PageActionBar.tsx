import type { ReactNode } from 'react';

interface PageActionBarProps {
  children: ReactNode;
}

/**
 * Holds page-specific controls in the document flow, below the sticky global
 * header. Actions therefore scroll with their page instead of occupying the
 * application-wide header.
 */
export function PageActionBar({ children }: PageActionBarProps) {
  return (
    <section
      aria-label="Page actions"
      className="mb-6 flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex w-full flex-wrap items-center justify-start gap-2">
        {children}
      </div>
    </section>
  );
}
