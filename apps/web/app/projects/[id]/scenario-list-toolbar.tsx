import { Search } from 'lucide-react';
import { useEffect, useRef } from 'react';

type ScenarioListToolbarProps<Status extends string> = {
  label: string;
  searchLabel: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  status: {
    label: string;
    value: Status;
    options: ReadonlyArray<{ value: Status; label: string; count: number }>;
    onChange: (status: Status) => void;
  };
  items: ReadonlyArray<{ tags?: string[] }>;
  tag: string;
  onTagChange: (tag: string) => void;
  visible: ReadonlyArray<{ id: string }>;
  selected: ReadonlySet<string>;
  onSelectionChange: (selected: Set<string>) => void;
  selectionDisabled?: boolean;
};

export function ScenarioListToolbar<Status extends string>({
  label, searchLabel, placeholder, query, onQueryChange, status, items, tag, onTagChange,
  visible, selected, onSelectionChange, selectionDisabled = false,
}: ScenarioListToolbarProps<Status>) {
  const search = useRef<HTMLInputElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const value of new Set(item.tags ?? [])) tagCounts.set(value, (tagCounts.get(value) ?? 0) + 1);
  }
  const tags = [...tagCounts.keys()].sort();
  const allChecked = visible.length > 0 && visible.every(item => selected.has(item.id));
  const someChecked = visible.some(item => selected.has(item.id));

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allChecked && someChecked;
  }, [allChecked, someChecked]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || (!event.ctrlKey && !event.metaKey) || !search.current?.getClientRects().length) return;
      event.preventDefault();
      search.current.focus();
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  function toggleVisible() {
    const next = new Set(selected);
    for (const item of visible) {
      if (allChecked) next.delete(item.id);
      else next.add(item.id);
    }
    onSelectionChange(next);
  }

  return <section className="scenario-toolbar" aria-label={label}>
    <div className="scenario-toolbar__top">
      <label className="scenario-search"><Search size={15} aria-hidden="true" />
        <input ref={search} type="search" aria-label={searchLabel} placeholder={placeholder} value={query}
          onChange={event => onQueryChange(event.target.value)} />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="scenario-segments" role="group" aria-label={status.label}>
        {status.options.map(({ value, label, count }) =>
          <button type="button" key={value} aria-pressed={status.value === value} onClick={() => status.onChange(value)}>{label} ({count})</button>)}
      </div>
    </div>
    <div className="scenario-toolbar__bottom">
      <div className="scenario-tag-filters" role="group" aria-label="Filtrar por etiqueta">
        <button type="button" aria-pressed={!tag} onClick={() => onTagChange('')}>Todos ({items.length})</button>
        {tags.map(value => <button type="button" key={value} className={/^@flujo/i.test(value) ? 'scenario-tag-filter--flow' : ''}
          aria-pressed={tag === value} onClick={() => onTagChange(tag === value ? '' : value)}>{value} ({tagCounts.get(value)})</button>)}
      </div>
      <label className="scenario-select-all"><input ref={selectAll} type="checkbox" checked={allChecked}
        disabled={selectionDisabled || !visible.length} onChange={toggleVisible} />Seleccionar visibles ({visible.length})</label>
      <span className="scenario-selection-count" role="status">{selected.size} seleccionados · {visible.length} visibles</span>
    </div>
  </section>;
}
