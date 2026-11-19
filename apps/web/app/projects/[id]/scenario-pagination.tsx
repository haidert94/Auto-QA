import { useEffect, useRef, useState } from 'react';

const PAGE_SIZES = [10, 20, 30] as const;

type ScenarioPaginationProps = {
  label: string;
  pageSize: number;
  currentPage: number;
  pageCount: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  changePage: (page: number) => void;
  changePageSize: (size: number) => void;
};

export function useScenarioPagination<Item>(items: readonly Item[]) {
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const results = useRef<HTMLUListElement>(null);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visible = items.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);

  function resetPage() { setPage(1); }

  function changePage(nextPage: number) {
    setPage(nextPage);
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'start' });
  }

  function changePageSize(size: number) {
    setPageSize(size);
    resetPage();
  }

  const pagination = {
    pageSize, currentPage, pageCount, pageStart, pageEnd: pageStart + visible.length, total: items.length,
    changePage, changePageSize,
  };
  return { visible, results, resetPage, pagination };
}

export function ScenarioPagination({
  label, pageSize, currentPage, pageCount, pageStart, pageEnd, total, changePage, changePageSize,
}: ScenarioPaginationProps) {
  return <nav className="scenario-pagination" aria-label={label}>
    <label>Escenarios por página
      <select value={pageSize} onChange={event => changePageSize(Number(event.target.value))}>
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    {total > 0 && <div className="scenario-pagination__navigation">
      {pageCount > 1 && <button type="button" className="secondary" aria-label="Página anterior"
        disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Anterior</button>}
      <span role="status">{pageStart + 1}–{pageEnd} de {total} · Página {currentPage} de {pageCount}</span>
      {pageCount > 1 && <button type="button" className="secondary" aria-label="Página siguiente"
        disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Siguiente</button>}
    </div>}
  </nav>;
}
