import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Page controls for long lists (clients, vendors). Lists of thousands of
// records are shown a page at a time: rendering every card at once took
// several seconds and froze the page.
//
// usePaged(items, pageSize, resetKey) returns the current page's items and
// the props for <Pager>. Changing resetKey (e.g. the search text) returns to
// page 1.

export function usePaged(items, pageSize, resetKey) {
  const [page, setPage] = React.useState(1);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  React.useEffect(() => { setPage(1); }, [resetKey]);
  // Stay on a page that exists when the list shrinks.
  const current = Math.min(page, pages);

  const start = (current - 1) * pageSize;
  const pageItems = React.useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  return { pageItems, pager: { page: current, pages, total, start, count: pageItems.length, setPage } };
}

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

export const Pager = ({ page, pages, total, start, count, setPage, noun = 'items', onPageChange }) => {
  if (total === 0) return null;
  const go = (p) => { setPage(p); onPageChange?.(p); };
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-zinc-400">
      <span>
        Showing {(start + 1).toLocaleString()}–{(start + count).toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="w-3.5 h-3.5" /> Previous
          </button>
          <span className="tabular-nums" aria-current="page">Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
          <button type="button" className={btn} onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Next page">
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </nav>
  );
};
