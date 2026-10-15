import { useEffect, useState } from 'react';

// Plan sheet column titles renamed by the Super Admin
// (GET /api/plan-column-labels): { plan: { field_key: label } }. One shared,
// cached copy; reloadPlanColumnLabels() after a rename refreshes every sheet.

let cache = null; // Promise<object> | null
const listeners = new Set();

const load = (apiFetch) => {
  if (!cache) {
    const p = apiFetch('/api/plan-column-labels')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => d.labels || {})
      .catch(() => { if (cache === p) cache = null; return {}; });
    cache = p;
  }
  return cache;
};

export const reloadPlanColumnLabels = () => {
  cache = null;
  listeners.forEach(fn => fn());
};

// Custom titles for one plan: { field_key: label }.
export const usePlanColumnLabels = (apiFetch, plan) => {
  const [all, setAll] = useState({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    listeners.add(bump);
    return () => listeners.delete(bump);
  }, []);
  useEffect(() => {
    let alive = true;
    load(apiFetch).then(l => { if (alive) setAll(l); });
    return () => { alive = false; };
  }, [apiFetch, version]);
  return all[plan] || {};
};
