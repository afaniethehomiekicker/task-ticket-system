import React, { useCallback, useEffect, useState } from 'react';
import { X, KeyRound, Check, Ban, Loader2, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// Edit requests for clients (server: internal/handlers/client_edit.go).
//
// Staff with the "Staff (Client Editor)" role can edit a client an Admin
// added for 30 minutes after it was added. After that, RequestEditModal sends
// a request with a reason to the Super Admin and Admins, who approve (for 30
// minutes, 2 hours or 24 hours) or reject it in EditRequestsPanel. The server
// enforces all of it; these screens only ask.

const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = `${btn} border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800`;
const inputCls = 'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500';

const DURATIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 120, label: '2 hours' },
  { minutes: 1440, label: '24 hours' },
];

const Modal = ({ title, onClose, busy, children, wide }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] flex flex-col rounded-xl bg-slate-100 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800`}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-600" aria-hidden="true" /> {title}
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

// ---- Staff: ask for edit access ---------------------------------------------

export const RequestEditModal = ({ client, onClose, onSent }) => {
  const { apiFetch } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const text = reason.trim();
    if (!text) { setError('Please say what you need to change and why.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/api/clients/${client.id}/edit-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'The request could not be sent.'); return; }
      onSent?.();
      onClose();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Request edit access" onClose={onClose} busy={busy}>
      <p className="text-xs text-slate-600 dark:text-zinc-400 mb-3">
        The 30 minutes for editing <b className="text-slate-800 dark:text-zinc-200">{client.companyName}</b>
        {client.clientNumber ? ` (${client.clientNumber})` : ''} after it was added have passed. Your request
        goes to the Super Admin and Admins; you'll get a notification when they decide.
      </p>
      <label htmlFor="edit-request-reason" className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
        What do you need to change, and why?
      </label>
      <textarea id="edit-request-reason" rows={4} maxLength={1000} value={reason} autoFocus
        onChange={(e) => setReason(e.target.value)} className={inputCls}
        placeholder="e.g. The mobile number was entered wrong; the correct one is 0300…" />
      <div className="flex justify-between items-center mt-1 text-[11px] text-slate-500">
        <span role="alert" className="text-rose-600 dark:text-rose-400">{error}</span>
        <span>{reason.length}/1000</span>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancel</button>
        <button type="button" onClick={send} disabled={busy || !reason.trim()} className={`${btn} bg-amber-600 hover:bg-amber-700 text-white`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Send request
        </button>
      </div>
    </Modal>
  );
};

// ---- Super Admin / Admin: decide requests ------------------------------------

const RequestRow = ({ req, onDecided }) => {
  const { apiFetch } = useApp();
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = async (action) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/api/clients/edit-requests/${req.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { minutes, note } : { note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'That did not work. Please try again.'); return; }
      onDecided(req.id, data.request);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-slate-800 dark:text-zinc-200">
          <b>{req.requester_name || 'A user'}</b> asks to edit{' '}
          <b>{req.company_name}</b>{req.client_number ? ` (${req.client_number})` : ''}
        </p>
        <span className="text-[11px] text-slate-500 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{when(req.created_at)}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-zinc-400 whitespace-pre-line bg-slate-100 dark:bg-zinc-950 rounded-md p-2">{req.reason}</p>

      {rejecting ? (
        <div className="space-y-2">
          <input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
            placeholder="Reason for not approving (optional, sent to the requester)" className={inputCls} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRejecting(false)} disabled={busy} className={btnSecondary}>Back</button>
            <button type="button" onClick={() => decide('reject')} disabled={busy} className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} Reject request
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-600 dark:text-zinc-400" htmlFor={`edit-req-duration-${req.id}`}>Allow editing for</label>
          <select id={`edit-req-duration-${req.id}`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
            className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100">
            {DURATIONS.map(d => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
          </select>
          <input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)" className={`${inputCls} flex-1 min-w-[140px] !w-auto`} />
          <button type="button" onClick={() => decide('approve')} disabled={busy} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
          </button>
          <button type="button" onClick={() => setRejecting(true)} disabled={busy} className={btnSecondary}>Reject</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </li>
  );
};

export const EditRequestsPanel = ({ onClose, onCountChange }) => {
  const { apiFetch } = useApp();
  const [view, setView] = useState('pending'); // pending | all
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (status) => {
    setRequests(null);
    setError('');
    try {
      const res = await apiFetch(`/api/clients/edit-requests?status=${status}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not load edit requests.'); setRequests([]); return; }
      setRequests(data.requests || []);
      if (status === 'pending') onCountChange?.((data.requests || []).length);
    } catch {
      setError('Could not reach the server.');
      setRequests([]);
    }
  }, [apiFetch, onCountChange]);

  useEffect(() => { load(view); }, [view, load]);

  const decided = (id) => {
    setRequests(prev => {
      const next = (prev || []).filter(r => r.id !== id);
      onCountChange?.(next.length);
      return next;
    });
  };

  const statusText = (r) => {
    if (r.status === 'approved') return `Approved by ${r.decided_by_name || 'an admin'} until ${when(r.expires_at)}`;
    if (r.status === 'rejected') return `Rejected by ${r.decided_by_name || 'an admin'}${r.decision_note ? `: ${r.decision_note}` : ''}`;
    return 'Waiting';
  };

  return (
    <Modal title="Client edit requests" onClose={onClose} wide>
      <p className="text-xs text-slate-600 dark:text-zinc-400 mb-3">
        Staff with the Client Editor role can edit a client an Admin added during the first 30 minutes. After that
        they ask here; approving lets them edit that one client for the time you choose. Every decision is recorded
        in the audit log.
      </p>
      <div role="tablist" className="inline-flex rounded-lg border border-slate-300 dark:border-zinc-700 overflow-hidden text-xs mb-3">
        {[['pending', 'Waiting'], ['all', 'Recent (all)']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
            className={`px-3 py-1.5 cursor-pointer ${view === key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400'}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs text-rose-600 mb-2">{error}</p>}
      {requests === null ? (
        <p className="text-xs text-slate-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-slate-500">{view === 'pending' ? 'No requests waiting.' : 'No requests yet.'}</p>
      ) : view === 'pending' ? (
        <ul className="space-y-2">{requests.map(r => <RequestRow key={r.id} req={r} onDecided={decided} />)}</ul>
      ) : (
        <ul className="space-y-2">
          {requests.map(r => (
            <li key={r.id} className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs space-y-1">
              <p className="text-slate-800 dark:text-zinc-200"><b>{r.requester_name}</b> — <b>{r.company_name}</b> {r.client_number ? `(${r.client_number})` : ''}</p>
              <p className="text-slate-500">{when(r.created_at)} · {r.reason}</p>
              <p className={r.status === 'approved' ? 'text-emerald-700 dark:text-emerald-400' : r.status === 'rejected' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}>{statusText(r)}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
