import { useEffect, useState } from 'react';

// Shared, cached copy of the active vendor list (GET /api/vendors) for
// vendor pickers. The Vendors page calls invalidateVendorList() after any
// change so pickers see it next time they open.

let cache = null;        // Promise<Array> | null
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
  if (!cache) {
    cache = apiFetch('/api/vendors')
      .then((r) => (r.ok ? r.json() : { vendors: [] }))
      .then((d) => (d.vendors || []).map(normalizeVendor).filter(Boolean))
      .catch(() => {
        cache = null; // retry next time
        return [];
      });
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
