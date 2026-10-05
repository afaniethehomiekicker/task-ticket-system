import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, FolderKanban, CheckSquare, LifeBuoy, Users, X, FileSearch, Building2, ListTree } from 'lucide-react';
import { TaskStatusBadge, TicketStatusBadge } from './Badge';

// Global search — spec slide 28: "Search by Unique ID, Client, Company,
// Project, Ticket Subject, Task, Staff, Vendor, City, or keyword."
//
// Searches everything the user is allowed to see (the lists are already
// scoped by the server). Typing an exact ID — TKT-100033, STK-000003,
// PRJ-000004, CL-000012, FEA-100001, USR-000007 — puts that record first.
// Ctrl/Cmd+K opens it from anywhere.

const norm = (v) => String(v ?? '').toLowerCase();
const has = (q, ...fields) => fields.some(f => norm(f).includes(q));
const idRe = /^(cl|prj|tkt|tsk|stk|fea|usr|dep)-\d+$/i;

export const GlobalSearchModal = () => {
  const {
    globalSearchOpen, setGlobalSearchOpen,
    visibleProjects, visibleTasks, visibleTickets, visibleFeasibilities, clients, allUsers,
    setSelectedTaskId, setSelectedTicketId, setSelectedProjectDetailId, setSelectedFeasibilityId,
    setActiveTab,
  } = useApp();

  const [query, setQuery] = useState('');

  // Ctrl/Cmd+K opens, Escape closes.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (e.key === 'Escape' && globalSearchOpen) setGlobalSearchOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [globalSearchOpen, setGlobalSearchOpen]);

  useEffect(() => { if (!globalSearchOpen) setQuery(''); }, [globalSearchOpen]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const userName = (id) => (allUsers || []).find(u => String(u.id) === String(id))?.name || '';

    const tickets = (visibleTickets || []).filter(t => has(q,
      t.ticketNumber, t.title, t.description, t.requesterCompany, t.requesterName, t.department,
      t.category, userName(t.assignedToId)));

    const tasks = (visibleTasks || []).filter(t => has(q,
      t.taskNumber, t.title, t.description, t.department, (t.labels || []).join(' '), userName(t.assignedToId)));

    // Sub-tasks, by their own STK- ID or title — opening one opens its task.
    const subtasks = [];
    (visibleTasks || []).forEach(t => (t.subTasks || []).forEach(st => {
      if (st && st.status !== 'archived' && has(q, st.subtaskNumber, st.title)) subtasks.push({ st, parent: t });
    }));

    const projects = (visibleProjects || []).filter(p => has(q,
      p.code, p.title, p.description, p.department, p.clientName,
      (p.clients || []).map(c => `${c.companyName} ${c.clientNumber}`).join(' ')));

    const feasibilities = (visibleFeasibilities || []).filter(f => has(q,
      f.feasibilityNumber, f.product, f.capacity, f.city, f.fromLocation, f.toLocation,
      f.client?.companyName, (f.vendors || []).map(v => v.vendorName).join(' ')));

    const clientList = (clients || []).filter(c => c.status !== 'archived' && has(q,
      c.clientNumber, c.companyName, c.clientName, c.contactPerson, c.city, c.email, c.phone, c.mobile));

    const people = (allUsers || []).filter(u => u.status !== 'archived' && has(q,
      u.userNumber, u.name, u.email, u.title, u.department));

    // Exact ID match goes to the top.
    let exact = null;
    if (idRe.test(q)) {
      const Q = q.toUpperCase();
      const t1 = tickets.find(t => t.ticketNumber === Q);
      const t2 = tasks.find(t => t.taskNumber === Q);
      const s1 = subtasks.find(x => x.st.subtaskNumber === Q);
      const p1 = projects.find(p => p.code === Q);
      const f1 = feasibilities.find(f => f.feasibilityNumber === Q);
      const c1 = clientList.find(c => c.clientNumber === Q);
      const u1 = people.find(u => u.userNumber === Q);
      exact = t1 ? { kind: 'ticket', rec: t1 } : t2 ? { kind: 'task', rec: t2 } : s1 ? { kind: 'subtask', rec: s1 }
        : p1 ? { kind: 'project', rec: p1 } : f1 ? { kind: 'feasibility', rec: f1 } : c1 ? { kind: 'client', rec: c1 }
        : u1 ? { kind: 'person', rec: u1 } : null;
    }

    return {
      exact,
      tickets: tickets.slice(0, 6), tasks: tasks.slice(0, 6), subtasks: subtasks.slice(0, 4),
      projects: projects.slice(0, 5), feasibilities: feasibilities.slice(0, 5),
      clients: clientList.slice(0, 5), people: people.slice(0, 5),
    };
  }, [query, visibleTickets, visibleTasks, visibleProjects, visibleFeasibilities, clients, allUsers]);

  if (!globalSearchOpen) return null;

  const close = () => setGlobalSearchOpen(false);
  const open = {
    ticket: (t) => { setSelectedTicketId(t.id); close(); },
    task: (t) => { setSelectedTaskId(t.id); close(); },
    subtask: (x) => { setSelectedTaskId(x.parent.id); close(); },
    project: (p) => { setSelectedProjectDetailId(p.id); close(); },
    feasibility: (f) => { setSelectedFeasibilityId(f.id); close(); },
    client: () => { setActiveTab('clients'); close(); },
    person: () => { setActiveTab('team'); close(); },
  };

  const Row = ({ icon: Icon, id, title, sub, right, onClick, highlight }) => (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left cursor-pointer transition ${highlight
        ? 'bg-indigo-100 dark:bg-indigo-950/50 border border-indigo-300 dark:border-indigo-800'
        : 'hover:bg-slate-300/60 dark:hover:bg-zinc-800/70'}`}>
      <Icon className="w-4 h-4 text-slate-500 dark:text-zinc-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-900 dark:text-zinc-100 truncate">
          {id && <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 mr-1.5">{id}</span>}
          <span className="font-semibold">{title}</span>
        </div>
        {sub && <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">{sub}</div>}
      </div>
      {right}
    </button>
  );

  const Group = ({ label, count, children }) => count > 0 && (
    <div className="mb-3">
      <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">{label} ({count})</div>
      {children}
    </div>
  );

  const renderExact = (x) => {
    const r = x.rec;
    switch (x.kind) {
      case 'ticket': return <Row highlight icon={LifeBuoy} id={r.ticketNumber} title={r.title} sub="Exact match · ticket" onClick={() => open.ticket(r)} right={<TicketStatusBadge status={r.status} />} />;
      case 'task': return <Row highlight icon={CheckSquare} id={r.taskNumber} title={r.title} sub="Exact match · task" onClick={() => open.task(r)} right={<TaskStatusBadge status={r.status} />} />;
      case 'subtask': return <Row highlight icon={ListTree} id={r.st.subtaskNumber} title={r.st.title} sub={`Exact match · sub-task of ${r.parent.taskNumber}`} onClick={() => open.subtask(r)} />;
      case 'project': return <Row highlight icon={FolderKanban} id={r.code} title={r.title} sub="Exact match · project" onClick={() => open.project(r)} />;
      case 'feasibility': return <Row highlight icon={FileSearch} id={r.feasibilityNumber} title={[r.product, r.capacity].filter(Boolean).join(' · ')} sub="Exact match · feasibility" onClick={() => open.feasibility(r)} />;
      case 'client': return <Row highlight icon={Building2} id={r.clientNumber} title={r.companyName} sub="Exact match · client" onClick={open.client} />;
      default: return <Row highlight icon={Users} id={r.userNumber} title={r.name} sub="Exact match · person" onClick={open.person} />;
    }
  };

  const nothing = results && !results.exact && ['tickets', 'tasks', 'subtasks', 'projects', 'feasibilities', 'clients', 'people']
    .every(k => results[k].length === 0);

  return (
    <div id="global-search-modal-backdrop" className="fixed inset-0 z-[80] flex items-start justify-center pt-20 bg-black/60 p-4" onClick={close}>
      <div className="w-full max-w-2xl bg-slate-100 dark:bg-zinc-950 rounded-xl shadow-2xl border border-slate-300 dark:border-zinc-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-300 dark:border-zinc-800">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID (TKT-…, TSK-…, CL-…), client, project, subject, staff, vendor, city…"
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-500 focus:outline-hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"><X className="w-4 h-4" /></button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!results && <p className="p-4 text-center text-xs text-slate-500 dark:text-zinc-400">Type at least 2 characters.</p>}
          {nothing && <p className="p-4 text-center text-xs text-slate-500 dark:text-zinc-400">Nothing found for “{query}”.</p>}
          {results && (<>
            {results.exact && <div className="mb-3">{renderExact(results.exact)}</div>}
            <Group label="Tickets" count={results.tickets.length}>
              {results.tickets.map(t => <Row key={t.id} icon={LifeBuoy} id={t.ticketNumber} title={t.title}
                sub={[t.requesterCompany, t.department].filter(Boolean).join(' · ')} onClick={() => open.ticket(t)} right={<TicketStatusBadge status={t.status} />} />)}
            </Group>
            <Group label="Tasks" count={results.tasks.length}>
              {results.tasks.map(t => <Row key={t.id} icon={CheckSquare} id={t.taskNumber} title={t.title}
                sub={t.department} onClick={() => open.task(t)} right={<TaskStatusBadge status={t.status} />} />)}
            </Group>
            <Group label="Sub-tasks" count={results.subtasks.length}>
              {results.subtasks.map(x => <Row key={x.st.id} icon={ListTree} id={x.st.subtaskNumber} title={x.st.title}
                sub={`of ${x.parent.taskNumber} ${x.parent.title}`} onClick={() => open.subtask(x)} />)}
            </Group>
            <Group label="Projects" count={results.projects.length}>
              {results.projects.map(p => <Row key={p.id} icon={FolderKanban} id={p.code} title={p.title}
                sub={[(p.clients || []).map(c => c.companyName).join(', ') || p.clientName, p.department].filter(Boolean).join(' · ')} onClick={() => open.project(p)} />)}
            </Group>
            <Group label="Feasibilities" count={results.feasibilities.length}>
              {results.feasibilities.map(f => <Row key={f.id} icon={FileSearch} id={f.feasibilityNumber}
                title={[f.product, f.capacity].filter(Boolean).join(' · ') || 'Feasibility'}
                sub={[f.client?.companyName, f.city, (f.vendors || []).map(v => v.vendorName).join(', ')].filter(Boolean).join(' · ')}
                onClick={() => open.feasibility(f)} />)}
            </Group>
            <Group label="Clients" count={results.clients.length}>
              {results.clients.map(c => <Row key={c.id} icon={Building2} id={c.clientNumber} title={c.companyName}
                sub={[c.clientName || c.contactPerson, c.city].filter(Boolean).join(' · ')} onClick={open.client} />)}
            </Group>
            <Group label="People" count={results.people.length}>
              {results.people.map(u => <Row key={u.id} icon={Users} id={u.userNumber} title={u.name}
                sub={[u.title, u.department].filter(Boolean).join(' · ')} onClick={open.person} />)}
            </Group>
          </>)}
        </div>
        <div className="px-4 py-2 border-t border-slate-300 dark:border-zinc-800 text-[10px] text-slate-500 dark:text-zinc-500">
          Only shows what you're allowed to see · Ctrl/⌘ + K to open · Esc to close
        </div>
      </div>
    </div>
  );
};
