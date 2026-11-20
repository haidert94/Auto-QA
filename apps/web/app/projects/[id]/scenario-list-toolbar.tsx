import { ChevronDown, Filter, Search } from 'lucide-react';
import { useEffect, useRef } from 'react';

type ScenarioVisibleSelectionProps = {
  visible: ReadonlyArray<{ id: string }>;
  selected: ReadonlySet<string>;
  onSelectionChange: (selected: Set<string>) => void;
  selectionDisabled?: boolean;
};

export function ScenarioVisibleSelection({
  visible, selected, onSelectionChange, selectionDisabled = false,
}: ScenarioVisibleSelectionProps) {
  const selectAll = useRef<HTMLInputElement>(null);
  const allChecked = visible.length > 0 && visible.every(item => selected.has(item.id));
  const someChecked = visible.some(item => selected.has(item.id));

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allChecked && someChecked;
  }, [allChecked, someChecked]);

  function toggleVisible() {
    const next = new Set(selected);
    for (const item of visible) {
      if (allChecked) next.delete(item.id);
      else next.add(item.id);
    }
    onSelectionChange(next);
  }

  return <div className="scenario-visible-selection" role="group" aria-label="Selección de escenarios visibles">
    <label className="scenario-select-all"><input ref={selectAll} type="checkbox" checked={allChecked}
      disabled={selectionDisabled || !visible.length} onChange={toggleVisible} />Seleccionar visibles ({visible.length})</label>
    <span className="scenario-selection-count" role="status">{selected.size} seleccionados · {visible.length} visibles</span>
  </div>;
}

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
};

export function ScenarioListToolbar<Status extends string>({
  label, searchLabel, placeholder, query, onQueryChange, status, items, tag, onTagChange,
}: ScenarioListToolbarProps<Status>) {
  const search = useRef<HTMLInputElement>(null);
  const tagMenu = useRef<HTMLDetailsElement>(null);
  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const value of new Set(item.tags ?? [])) tagCounts.set(value, (tagCounts.get(value) ?? 0) + 1);
  }
  const tags = [...tagCounts.keys()].sort();
  const activeTagLabel = tag ? `${tag} (${tagCounts.get(tag) ?? 0})` : `Todas las etiquetas (${items.length})`;

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || (!event.ctrlKey && !event.metaKey) || !search.current?.getClientRects().length) return;
      event.preventDefault();
      search.current.focus();
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      const menu = tagMenu.current;
      if (!menu || !menu.open) return;
      if (menu.contains(event.target as Node)) return;
      menu.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !tagMenu.current?.open) return;
      tagMenu.current.open = false;
    }
    document.addEventListener('click', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function pickTag(next: string) {
    onTagChange(next);
    if (tagMenu.current) tagMenu.current.open = false;
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
      <details ref={tagMenu} className="scenario-tag-filters-menu">
        <summary aria-label="Filtrar por etiqueta">
          <Filter size={14} aria-hidden="true" />
          <span>{activeTagLabel}</span>
          <ChevronDown size={14} aria-hidden="true" className="scenario-tag-filters-menu__chevron" />
        </summary>
        <div className="scenario-tag-filters-menu__options" role="group" aria-label="Opciones de etiqueta">
          <button type="button" aria-pressed={!tag} onClick={() => pickTag('')}>Todos ({items.length})</button>
          {tags.map(value => <button type="button" key={value}
            className={/^@flujo/i.test(value) ? 'scenario-tag-filter--flow' : ''}
            aria-pressed={tag === value}
            onClick={() => pickTag(tag === value ? '' : value)}>{value} ({tagCounts.get(value)})</button>)}
        </div>
      </details>
    </div>
  </section>;
}
