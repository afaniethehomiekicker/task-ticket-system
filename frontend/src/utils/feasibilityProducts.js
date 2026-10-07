// Feasibility products — one shared list for the create form, the edit form
// and the filter (they used to each keep their own copy).
//
// Besides the standard products, a product that isn't in the list can be
// typed in ("New product"). Products typed in on earlier feasibilities are
// offered in the dropdown afterwards, so the next person can just pick them.
// The backend's GET /api/feasibilities/products returns the same list.

export const STANDARD_FEASIBILITY_PRODUCTS = ['DPLC', 'Dark Fiber', 'IPT', 'IPT Mix', 'Pure IPT'];

export const MAX_PRODUCT_LENGTH = 100;
export const MAX_SUBJECT_LENGTH = 200;

// Standard products first, then every other product used on a feasibility
// (case-insensitive de-duplication, alphabetical). Takes product names (the
// server's /api/feasibilities/products list) and/or feasibility records.
export function feasibilityProductOptions(items = []) {
  const seen = new Set(STANDARD_FEASIBILITY_PRODUCTS.map(p => p.toLowerCase()));
  const custom = [];
  for (const f of items || []) {
    const p = (typeof f === 'string' ? f : (f?.product || '')).trim();
    if (p && !seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      custom.push(p);
    }
  }
  custom.sort((a, b) => a.localeCompare(b));
  return [...STANDARD_FEASIBILITY_PRODUCTS, ...custom];
}

// The existing spelling of a typed product, if it's already in the list
// ("dplc" → "DPLC"), so the same product isn't saved under two spellings.
export function matchExistingProduct(typed, options) {
  const t = (typed || '').trim();
  return options.find(p => p.toLowerCase() === t.toLowerCase()) || t;
}
