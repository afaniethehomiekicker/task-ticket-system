// Soft checks for plan sheets: they produce warnings shown on the cell, never
// block saving (real-world entries like "103.191.118.140-143" or "see NOC
// sheet" must still be possible).

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const isIPv4 = (s) => IPV4.test(s);

const isIPv6 = (s) => {
  if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return false;
  if ((s.match(/::/g) || []).length > 1) return false;
  const parts = s.split(':');
  return parts.length >= 3 && parts.length <= 8 && parts.every(p => p.length <= 4 || isIPv4(p));
};

// One address, subnet (/nn) or short range (a.b.c.d-e or a.b.c.d-a.b.c.e).
const isAddressToken = (t, allowPrefix) => {
  const [addr, prefix, extra] = t.split('/');
  if (extra !== undefined) return false;
  if (prefix !== undefined) {
    if (!allowPrefix || !/^\d{1,3}$/.test(prefix)) return false;
    const n = Number(prefix);
    if (isIPv4(addr)) return n <= 32;
    if (isIPv6(addr)) return n <= 128;
    return false;
  }
  if (isIPv4(t) || isIPv6(t)) return true;
  const range = t.match(/^(.+)-(.+)$/);
  if (range && isIPv4(range[1])) {
    return /^\d{1,3}$/.test(range[2]) ? Number(range[2]) <= 255 : isIPv4(range[2]);
  }
  return false;
};

const tokens = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean);

export const ipWarning = (value, { allowPrefix = true } = {}) => {
  const list = tokens(value);
  if (list.length === 0) return '';
  const bad = list.filter(t => !isAddressToken(t, allowPrefix));
  if (bad.length === 0) return '';
  return `Doesn't look like an IP address${allowPrefix ? ' or subnet' : ''}: ${bad.slice(0, 3).join(', ')}`;
};

export const vlanWarning = (value) => {
  const list = tokens(value);
  if (list.length === 0) return '';
  for (const t of list) {
    const m = t.match(/^(\d{1,4})(?:-(\d{1,4}))?$/);
    if (!m) return `VLAN should be a number (1–4094), a range like 100-200, or a list: "${t}"`;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > 4094 || b < a) return `VLAN out of range (1–4094): "${t}"`;
  }
  return '';
};

// Same value already used on another active row of the sheet.
export const duplicateWarning = (key, label) => (value, row, allRows) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  const others = allRows.filter(r => r.key !== row.key && String(r.data[key] || '').trim().toLowerCase() === v);
  return others.length ? `${label} ${value} is also used on ${others.length} other row${others.length === 1 ? '' : 's'}` : '';
};

// Combine several checks; the first warning wins.
export const allOf = (...checks) => (value, row, allRows) => {
  for (const check of checks) {
    const w = check(value, row, allRows);
    if (w) return w;
  }
  return '';
};
