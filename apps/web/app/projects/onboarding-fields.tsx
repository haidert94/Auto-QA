'use client';

import type { ReactNode } from 'react';
import {
  accessModes, browserLabels, environmentTypes, limitFields,
  type EnvironmentForm, type ExecutionForm, type RoleForm,
} from './onboarding';

export function TextField({ label, value, onChange, maxLength, required, placeholder, multiline }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label>
      {label}
      {multiline
        ? <textarea rows={3} {...{ value, required, maxLength, placeholder }} onChange={event => onChange(event.target.value)} />
        : <input {...{ value, required, maxLength, placeholder }} onChange={event => onChange(event.target.value)} />}
    </label>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T | '';
  options: Record<T, string>;
  onChange: (value: T | '') => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={event => onChange(event.target.value as T | '')}>
        <option value="">Seleccionar</option>
        {Object.entries<string>(options).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </label>
  );
}

function RemoveButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className="secondary" onClick={onClick}>{children}</button>;
}

export function EnvironmentFields({ index, value, onChange, onRemove }: {
  index: number;
  value: EnvironmentForm;
  onChange: (value: EnvironmentForm) => void;
  onRemove: () => void;
}) {
  function change<K extends keyof EnvironmentForm>(key: K, next: EnvironmentForm[K], affectsScope = false) {
    onChange({
      ...value,
      ...(affectsScope ? { authorizationConfirmed: false, authorizedAt: null } : {}),
      [key]: next,
    });
  }

  return (
    <fieldset>
      <legend>Entorno {index + 1}</legend>
      <div className="form-grid">
        <SelectField label="Tipo de entorno" value={value.type} options={environmentTypes}
          onChange={next => change('type', next, true)} />
        <SelectField label="Modo de acceso" value={value.accessMode} options={accessModes}
          onChange={next => change('accessMode', next, true)} />
      </div>
      <TextField label="URL base HTTPS" maxLength={2048} value={value.baseUrl}
        placeholder="https://qa.ejemplo.com/portal" onChange={next => change('baseUrl', next, true)} />
      <TextField label="Dominios permitidos, uno por línea" value={value.allowedHosts}
        placeholder="qa.ejemplo.com" multiline onChange={next => change('allowedHosts', next, true)} />
      <div className="form-grid">
        <TextField label="Rutas permitidas, una por línea" value={value.allowedPaths}
          placeholder="qa.ejemplo.com/portal" multiline onChange={next => change('allowedPaths', next, true)} />
        <TextField label="Rutas excluidas, una por línea" value={value.excludedPaths}
          placeholder="qa.ejemplo.com/portal/pagos" multiline onChange={next => change('excludedPaths', next, true)} />
      </div>
      <p className="muted">Escribe cada ruta como dominio/ruta. Un prefijo incluye sus subrutas y las exclusiones tienen prioridad.</p>
      <TextField label="Acciones prohibidas, una por línea" value={value.prohibitedActions}
        multiline onChange={next => change('prohibitedActions', next, true)} />
      <label className="check">
        <input type="checkbox" checked={value.readOnly}
          onChange={event => change('readOnly', event.target.checked, true)} />
        Solo lectura
      </label>
      <label className="check">
        <input type="checkbox" checked={value.authorizationConfirmed} disabled={!value.baseUrl.trim()}
          onChange={event => change('authorizationConfirmed', event.target.checked)} />
        Confirmo que tengo autorización para probar este entorno dentro del alcance declarado.
      </label>
      {value.authorizationConfirmed && value.authorizedAt && <p className="muted">
        Confirmada el <time dateTime={value.authorizedAt}>{value.authorizedAt.slice(0, 19).replace('T', ' ')} UTC</time>
      </p>}
      <details>
        <summary>Datos de prueba e integraciones</summary>
        <TextField label="Datos sintéticos" value={value.syntheticData} maxLength={1000}
          multiline onChange={next => change('syntheticData', next)} />
        <TextField label="Semillas" value={value.seeds} maxLength={1000}
          onChange={next => change('seeds', next)} />
        <TextField label="Estrategia de limpieza" value={value.cleanupStrategy} maxLength={1000}
          multiline onChange={next => change('cleanupStrategy', next)} />
        <TextField label="Integraciones de prueba, una por línea" value={value.integrations}
          multiline onChange={next => change('integrations', next)} />
      </details>
      <RemoveButton onClick={onRemove}>Quitar entorno {index + 1}</RemoveButton>
    </fieldset>
  );
}

export function RoleFields({ index, value, onChange, onRemove }: {
  index: number;
  value: RoleForm;
  onChange: (value: RoleForm) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset>
      <legend>Rol {index + 1}</legend>
      <TextField label="Nombre del rol" value={value.name} maxLength={120} required
        onChange={name => onChange({ ...value, name })} />
      <TextField label="Descripción del rol" value={value.description} maxLength={500}
        onChange={description => onChange({ ...value, description })} />
      <TextField label="Referencia externa a cuenta de prueba" value={value.secretReference} maxLength={186}
        placeholder="vault:qa/lector" onChange={secretReference => onChange({ ...value, secretReference })} />
      {value.permissions.map((permission, position) => {
        function change(next: typeof permission) {
          onChange({ ...value, permissions: value.permissions.map((row, n) => n === position ? next : row) });
        }
        return (
          <fieldset className="permission" key={position}>
            <legend>Permiso {position + 1}</legend>
            <div className="form-grid">
              <TextField label="Recurso" value={permission.resource} maxLength={160} required
                onChange={resource => change({ ...permission, resource })} />
              <TextField label="Acción" value={permission.action} maxLength={160} required
                onChange={action => change({ ...permission, action })} />
            </div>
            <label>Permiso esperado
              <select value={permission.allowed ? 'allow' : 'deny'}
                onChange={event => change({ ...permission, allowed: event.target.value === 'allow' })}>
                <option value="allow">Permitido</option>
                <option value="deny">Denegado</option>
              </select>
            </label>
            <RemoveButton onClick={() => onChange({
              ...value, permissions: value.permissions.filter((_, n) => n !== position),
            })}>Quitar permiso {position + 1}</RemoveButton>
          </fieldset>
        );
      })}
      <div className="actions">
        <button type="button" className="secondary" disabled={value.permissions.length >= 50}
          onClick={() => onChange({
            ...value, permissions: [...value.permissions, { resource: '', action: '', allowed: false }],
          })}>Agregar permiso</button>
        <RemoveButton onClick={onRemove}>Quitar rol {index + 1}</RemoveButton>
      </div>
    </fieldset>
  );
}

export function ExecutionFields({ value, onChange }: {
  value: ExecutionForm;
  onChange: (value: ExecutionForm) => void;
}) {
  return (
    <details>
      <summary>Preferencias de ejecución y notificaciones</summary>
      <div className="form-grid">
        <SelectField label="Navegador" value={value.browser} options={browserLabels}
          onChange={browser => onChange({ ...value, browser })} />
        <TextField label="Frecuencia prevista" value={value.frequency} maxLength={160}
          onChange={frequency => onChange({ ...value, frequency })} />
        {(Object.keys(limitFields) as (keyof typeof limitFields)[]).map(key => (
          <label key={key}>{limitFields[key]}
            <input type="number" min={1} max={2147483647} step={1} value={value[key]}
              onChange={event => onChange({ ...value, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <TextField label="Preferencias de notificación" value={value.notifications} maxLength={500} multiline
        onChange={notifications => onChange({ ...value, notifications })} />
    </details>
  );
}
