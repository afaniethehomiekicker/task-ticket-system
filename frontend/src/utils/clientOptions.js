// Client filter options built from the records a page already has.
//
// The client book isn't kept in the browser any more (it can run to
// thousands), and a filter listing every client was mostly clients with no
// records on that page anyway. These list just the clients that appear in
// the page's own records, as [id, name] pairs sorted by name — what the
// FilterSelect components expect.

const collect = (pairs) => {
  const byId = new Map();
  for (const [id, name] of pairs) {
    if (id === null || id === undefined || id === '') continue;
    const key = String(id);
    if (!byId.has(key) || (!byId.get(key) && name)) byId.set(key, name || '');
  }
  return [...byId.entries()]
    .map(([id, name]) => [id, name || `Client #${id}`])
    .sort((a, b) => a[1].localeCompare(b[1]));
};

// Projects: the primary client and every linked one.
function* projectClientPairs(projects) {
  for (const p of projects || []) {
    if (!p) continue;
    if (p.clientId) yield [p.clientId, p.clientName];
    for (const c of p.clients || []) yield [c.id, c.companyName];
  }
}

export const clientOptionsFromProjects = (projects) => collect(projectClientPairs(projects));

export const clientOptionsFromTickets = (tickets) =>
  collect((tickets || []).filter(Boolean).map(t => [t.clientId, t.clientName || t.requesterCompany]));

export const clientOptionsFromFeasibilities = (feasibilities) =>
  collect((feasibilities || []).filter(Boolean).map(f => [f.clientId, f.client?.companyName]));
