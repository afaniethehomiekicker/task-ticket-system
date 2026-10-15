import { useEffect, useState } from 'react';

// Shared, cached copy of the active vendor list (GET /api/vendors) for
// vendor pickers. The Vendors page calls invalidateVendorList() after any
// change, and the feasibility "Add vendor" form refreshes it every time it
// opens, so a vendor added on the Vendors page (in this tab, another tab, or
// by someone else) is always offered.
//
// The cache used to live for the whole session and also kept an empty list
// when the first request failed (e.g. it ran before sign-in finished), so
// vendors added later never showed up in the picker until a full reload.

const MAX_AGE_MS = 60 * 1000;

let cache = null;        // Promise<Array> | null
let cachedAt = 0;
const listeners = new Set();

export const normalizeVendor = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    vendorNumber: raw.vendor_number || '',
    name: raw.name || '',
    contactPerson: raw.contact_person || '',
    phone: raw.phone || '',
    email: raw.email || '',
    cities: raw.cities || '',
    services: raw.services || '',
    notes: raw.notes || '',
    status: raw.status || 'active',
    archivedAt: raw.archived_at || null,
    createdAt: raw.created_at || raw.CreatedAt || null,
    stats: {
      total: raw.stats?.total || 0,
      feasible: raw.stats?.feasible || 0,
      notFeasible: raw.stats?.not_feasible || 0,
      pending: raw.stats?.pending || 0,
    },
  };
};

const load = (apiFetch) => {
  if (!cache || Date.now() - cachedAt > MAX_AGE_MS) {
    cachedAt = Date.now();
    const p = apiFetch('/api/vendors')
      .then((r) => {
        if (!r.ok) throw new Error(`vendors: HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (d.vendors || []).map(normalizeVendor).filter(Boolean))
      .catch(() => {
        if (cache === p) cache = null; // never keep a failed load — retry next time
        return [];
      });
    cache = p;
  }
  return cache;
};

export const invalidateVendorList = () => {
  cache = null;
  listeners.forEach((fn) => fn());
};

export const useVendorList = (apiFetch) => {
  const [vendors, setVendors] = useState([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    listeners.add(bump);
    return () => listeners.delete(bump);
  }, []);

  useEffect(() => {
    let alive = true;
    load(apiFetch).then((list) => { if (alive) setVendors(list); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return vendors;
};

// The master vendor a typed name refers to (case and spaces ignored).
export const findVendorByName = (vendors, name) => {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  return vendors.find((v) => v.name.trim().toLowerCase() === key) || null;
};
