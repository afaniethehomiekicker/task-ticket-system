import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  X, Clock, AlertTriangle, ShieldAlert, Pencil, Trash2, Send, Lock,
  User as UserIcon, Building, Paperclip, MessageSquare
} from 'lucide-react';
import { PriorityBadge, TicketStatusBadge, RoleBadge } from '../common/Badge';
import { canEscalateTicket, canAssignTickets } from '../../utils/permissions';

// Rebuilt from scratch after the original file was overwritten. It reads the
// same context state TicketsView already drives (selectedTicketId) and calls
// the real ticket actions in AppContext, so every change goes to the backend
// and is only shown once the server has accepted it.

const FALLBACK_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E";

// The backend's own ticket statuses. "escalated" isn't one: escalation is
// tracked separately (escalationLevel), and "archived" is only reachable via
// the archive action.
const STATUS_OPTIONS = [
  ['new', 'New'],
  ['assigned', 'Assigned'],
  ['in_progress', 'In Progress'],
  ['pending', 'Pending'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
  ['cancelled', 'Cancelled'],
];

// Escalation chain from the spec: staff -> department head -> department
// admin -> super admin. The values are what escalateTicket()/the backend use.
const ESCALATION_LEVELS = [
  ['supervisor', 'Supervisor / Department head'],
  ['admin', 'Department admin'],
  ['super_admin', 'Super admin'],
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export const TicketDetailDrawer = () => {
  const {
    tickets,
    selectedTicketId,
    setSelectedTicketId,
    setSelectedTicketEditId,
    allUsers,
    currentUser,
    permissionMatrix,
    updateTicketStatus,
    escalateTicket,
    addTicketComment,
    addTicketInternalNote,
    assignTicket,
    deleteTicket,
  } = useApp();

  const [tab, setTab] = useState('public');
  const [commentText, setCommentText] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [showEscalate, setShowEscalate] = useState(false);
  const [escLevel, setEscLevel] = useState('supervisor');
  const [escReason, setEscReason] = useState('');

  if (!selectedTicketId) return null;
  const ticket = (tickets || []).find(t => String(t.id) === String(selectedTicketId));
  if (!ticket || !currentUser) return null;

  const users = allUsers || [];
  const assignee = users.find(u => String(u.id) === String(ticket.assignedToId));
  const agents = users.filter(u => u.status !== 'inactive');

  const isClosedOut = ticket.status === 'closed' || ticket.status === 'cancelled' || ticket.status === 'archived';
  const isEscalated = ticket.escalationLevel && ticket.escalationLevel !== 'none';
  const canEscalate = !isClosedOut && ticket.status !== 'resolved' && canEscalateTicket(currentUser, ticket, permissionMatrix);
  const canAssign = canAssignTickets(currentUser, permissionMatrix);
  const isAdminTier = currentUser.role === 'super_admin' || currentUser.role === 'admin';

  const publicComments = ticket.comments || [];
  const internalNotes = ticket.internalNotes || [];
  const visibleComments = tab === 'internal' ? internalNotes : publicComments;

  const close = () => setSelectedTicketId(null);

  const handleStatusChange = async (next) => {
    if (!next || next === ticket.status) return;
    if (next === 'resolved') {
      // A resolution needs a summary — collect it before calling the API.
      setResolving(true);
      return;
    }
    setIsBusy(true);
    await updateTicketStatus(ticket.id, next);
    setIsBusy(false);
  };

  const confirmResolve = async () => {
    if (!resolutionSummary.trim()) return;
    setIsBusy(true);
    await updateTicketStatus(ticket.id, 'resolved', resolutionSummary.trim());
    setIsBusy(false);
    setResolving(false);
    setResolutionSummary('');
  };

  const handleAssign = async (value) => {
    if (!value || String(value) === String(ticket.assignedToId)) return;
    setIsBusy(true);
    await assignTicket(ticket.id, value);
    setIsBusy(false);
  };

  const confirmEscalate = async () => {
    if (!escReason.trim()) return;
    setIsBusy(true);
    const ok = await escalateTicket(ticket.id, escLevel, escReason.trim());
    setIsBusy(false);
    if (ok) {
      setShowEscalate(false);
      setEscReason('');
    }
  };

  const handlePost = async (e) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    setIsPosting(true);
    const saved = tab === 'internal'
      ? await addTicketInternalNote(ticket.id, text)
      : await addTicketComment(ticket.id, text);
    setIsPosting(false);
    if (saved) setCommentText('');
  };

  const handleArchive = async () => {
    if (!window.confirm(`Archive ${ticket.ticketNumber}? It will leave the default list but stays available for audit.`)) return;
    const ok = await deleteTicket(ticket.id);
    if (ok !== false) close();
  };

  return (
    <div
      id="ticket-detail-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={close}
    >
      <div
        id="ticket-detail-drawer-container"
        className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 h-full shadow-2xl border-l border-slate-300 dark:border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded">
                {ticket.ticketNumber}
              </span>
              <TicketStatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              {ticket.slaBreached && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 uppercase">
                  <AlertTriangle className="w-3 h-3" /> SLA breached
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 break-words">{ticket.title}</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { setSelectedTicketId(null); setSelectedTicketEditId(ticket.id); }}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
              title="Edit ticket"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={close}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Escalation banner */}
          {isEscalated && (
            <div className="p-4 rounded-xl bg-rose-100/80 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-rose-900 dark:text-rose-200 uppercase">
                  Escalated to {ticket.escalationLevel.replace('_', ' ')}
                </h4>
                {ticket.escalationReason && (
                  <p className="text-xs text-rose-800 dark:text-rose-300 mt-0.5">{ticket.escalationReason}</p>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {ticket.description || 'No description provided.'}
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Category</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200">{ticket.category || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Department</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <Building className="w-3 h-3" /> {ticket.department || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Requester</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 block">
                {ticket.requesterName || '—'}
                {ticket.requesterCompany ? ` · ${ticket.requesterCompany}` : ''}
              </span>
              {ticket.requesterEmail && (
                <span className="text-[11px] text-slate-500 dark:text-zinc-400">{ticket.requesterEmail}</span>
              )}
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">SLA target</span>
              <span className={`font-medium flex items-center gap-1 ${ticket.slaBreached ? 'text-rose-600' : 'text-slate-900 dark:text-zinc-200'}`}>
                <Clock className="w-3 h-3" /> {fmt(ticket.slaDueTime)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Created</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200">{fmt(ticket.createdAt)}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">First response</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200">{fmt(ticket.firstResponseAt)}</span>
            </div>
            {ticket.resolvedAt && (
              <div>
                <span className="text-slate-500 dark:text-zinc-400 block mb-1">Resolved</span>
                <span className="font-medium text-slate-900 dark:text-zinc-200">{fmt(ticket.resolvedAt)}</span>
              </div>
            )}
            {ticket.closedAt && (
              <div>
                <span className="text-slate-500 dark:text-zinc-400 block mb-1">Closed</span>
                <span className="font-medium text-slate-900 dark:text-zinc-200">{fmt(ticket.closedAt)}</span>
              </div>
            )}
          </div>

          {/* Assignment */}
          <div>
            <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 mb-2 flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5" /> Assigned agent
            </h3>
            <div className="flex items-center gap-3">
              <img
                src={assignee?.avatar || FALLBACK_AVATAR}
                alt={assignee?.name || 'Unassigned'}
                className="w-7 h-7 rounded-full object-cover"
              />
              <select
                id="ticket-assignee-select"
                value={ticket.assignedToId ?? ''}
                onChange={(e) => handleAssign(e.target.value)}
                disabled={!canAssign || isBusy}
                title={!canAssign ? "You don't have permission to reassign tickets" : undefined}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-60"
              >
                {!ticket.assignedToId && <option value="">Unassigned</option>}
                {agents.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Resolution summary */}
          {ticket.resolutionSummary && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
              <h3 className="text-xs font-bold text-emerald-900 dark:text-emerald-200 mb-1">Resolution</h3>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap">{ticket.resolutionSummary}</p>
            </div>
          )}

          {/* Attachments */}
          {(ticket.attachments || []).length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 mb-2 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Attachments ({ticket.attachments.length})
              </h3>
              <ul className="space-y-1.5">
                {ticket.attachments.map(a => (
                  <li key={a.id} className="text-xs flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800">
                    <span className="truncate font-medium text-slate-800 dark:text-zinc-200">{a.name || 'Attachment'}</span>
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400 shrink-0">
                      {a.uploadedByName ? `${a.uploadedByName} · ` : ''}{fmt(a.uploadedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Discussion */}
          <div>
            <div className="flex items-center gap-1 mb-3 border-b border-slate-300 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setTab('public')}
                className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px cursor-pointer ${
                  tab === 'public'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                    : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Replies ({publicComments.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('internal')}
                className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px cursor-pointer ${
                  tab === 'internal'
                    ? 'border-purple-500 text-purple-700 dark:text-purple-400'
                    : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                }`}
              >
                <Lock className="w-3.5 h-3.5" /> Internal notes ({internalNotes.length})
              </button>
            </div>

            <div className="space-y-3 mb-3">
              {visibleComments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-zinc-500 italic">
                  {tab === 'internal' ? 'No internal notes yet.' : 'No replies yet.'}
                </p>
              ) : (
                visibleComments.map(c => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-xl border text-xs ${
                      c.isInternal
                        ? 'bg-purple-50/70 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900'
                        : 'bg-slate-100 dark:bg-zinc-900/60 border-slate-300 dark:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <img src={c.authorAvatar || FALLBACK_AVATAR} alt="" className="w-5 h-5 rounded-full object-cover" />
                      <span className="font-semibold text-slate-900 dark:text-zinc-100">{c.authorName || 'Unknown'}</span>
                      {c.authorRole && <RoleBadge role={c.authorRole} size="xs" />}
                      <span className="ml-auto text-[10px] text-slate-500 dark:text-zinc-500">{fmt(c.createdAt)}</span>
                    </div>
                    <p className="text-slate-800 dark:text-zinc-300 whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))
              )}
            </div>

            {!isClosedOut && (
              <form onSubmit={handlePost} className="flex items-start gap-2">
                <textarea
                  rows={2}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  disabled={isPosting}
                  placeholder={tab === 'internal' ? 'Add an internal note (not a reply)...' : 'Write a reply...'}
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-amber-500 resize-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isPosting || !commentText.trim()}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> {isPosting ? 'Posting...' : 'Post'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-950 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium">Status:</span>
              <select
                id="ticket-status-select"
                value={ticket.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={isBusy || ticket.status === 'archived'}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-medium focus:outline-hidden disabled:opacity-60"
              >
                {!STATUS_OPTIONS.some(([v]) => v === ticket.status) && (
                  <option value={ticket.status}>{ticket.status}</option>
                )}
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {canEscalate && !showEscalate && (
                <button
                  type="button"
                  id="ticket-escalate-btn"
                  onClick={() => setShowEscalate(true)}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" /> Escalate
                </button>
              )}
              {isAdminTier && ticket.status !== 'archived' && (
                <button
                  type="button"
                  id="ticket-archive-btn"
                  onClick={handleArchive}
                  className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg cursor-pointer"
                  title="Archive ticket"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {resolving && (
            <div className="space-y-2">
              <textarea
                rows={2}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                disabled={isBusy}
                placeholder="Resolution summary (required) — what fixed it?"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none disabled:opacity-60"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setResolving(false); setResolutionSummary(''); }}
                  disabled={isBusy}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmResolve}
                  disabled={isBusy || !resolutionSummary.trim()}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  {isBusy ? 'Saving...' : 'Mark resolved'}
                </button>
              </div>
            </div>
          )}

          {showEscalate && (
            <div className="space-y-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-rose-900 dark:text-rose-200">Escalate to</span>
                <select
                  value={escLevel}
                  onChange={(e) => setEscLevel(e.target.value)}
                  disabled={isBusy}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                >
                  {ESCALATION_LEVELS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                value={escReason}
                onChange={(e) => setEscReason(e.target.value)}
                disabled={isBusy}
                placeholder="Reason for escalation (required)..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none disabled:opacity-60"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setShowEscalate(false); setEscReason(''); }}
                  disabled={isBusy}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmEscalate}
                  disabled={isBusy || !escReason.trim()}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  {isBusy ? 'Escalating...' : 'Confirm escalation'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};