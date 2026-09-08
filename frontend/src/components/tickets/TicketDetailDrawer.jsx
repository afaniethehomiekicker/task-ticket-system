import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  X, LifeBuoy, Send, Clock, UserCheck, ShieldAlert, ArrowUpRight, 
  MessageSquare, Lock, Globe, AlertTriangle, CheckCircle, RotateCcw, Building
} from 'lucide-react';
import { PriorityBadge, TicketStatusBadge, RoleBadge } from '../common/Badge';
import { canEscalateTicket, canAssignTickets } from '../../utils/permissions';

export const TicketDetailDrawer = () => {
  const { 
    selectedTicketId, 
    setSelectedTicketId, 
    tickets, 
    allUsers, 
    projects,
    currentUser, 
    updateTicketStatus, 
    escalateTicket, 
    addTicketResponse,
    assignTicket
  } = useApp();

  const [responseText, setResponseText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [showEscalateModal, setShowEscalateModal] = useState(false);

  if (!selectedTicketId) return null;

  const ticket = tickets.find(t => t.id === selectedTicketId);
  if (!ticket) return null;

  const ticketResponses = ticket.responses || [];

  const assignee = allUsers.find(u => u.id === ticket.assignedToId);
  const project = projects.find(p => p.id === ticket.projectId);

  const handleSendResponse = (e) => {
    e.preventDefault();
    if (!responseText.trim()) return;
    addTicketResponse(ticket.id, responseText, isInternalNote);
    setResponseText('');
  };

  const handleEscalate = (targetLevel) => {
    if (!escalateReason.trim()) {
      alert('Please enter a reason for escalation');
      return;
    }
    escalateTicket(ticket.id, targetLevel, escalateReason);
    setShowEscalateModal(false);
    setEscalateReason('');
  };

  return (
    <div 
      id="ticket-detail-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={() => setSelectedTicketId(null)}
    >
      <div 
        id="ticket-detail-drawer-container"
        className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 h-full shadow-2xl border-l border-slate-300 dark:border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 rounded">
              {ticket.ticketNumber}
            </span>
            <TicketStatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>

          <div className="flex items-center gap-2">
            <button
              id="close-ticket-detail-drawer"
              onClick={() => setSelectedTicketId(null)}
              className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Safe Escalation Alert Banner */}
          {ticket.escalationLevel && ticket.escalationLevel !== 'none' && (
            <div className="p-4 rounded-xl bg-rose-100/80 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-rose-900 dark:text-rose-200 uppercase tracking-wide">
                  Escalated to {(ticket.escalationLevel || '').replace('_', ' ')}
                </h4>
                <p className="text-xs text-rose-800 dark:text-rose-300 mt-0.5">
                  Reason: {ticket.escalationReason || 'High priority SLA risk or complex stakeholder incident.'}
                </p>
              </div>
            </div>
          )}

          {/* Title & Customer Information */}
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 mb-2">
              {ticket.title}
            </h2>
            <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-300 leading-relaxed">
              {ticket.description}
            </div>
          </div>

          {/* Requester & SLA Details */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border border-slate-300 dark:border-zinc-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Requester</span>
              <span className="font-semibold text-slate-900 dark:text-zinc-100 block truncate">
                {ticket.requesterName}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 block truncate">{ticket.requesterEmail}</span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Organization</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 block truncate">
                {ticket.requesterCompany || 'External User'}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Category</span>
              <span className="font-medium text-indigo-600 dark:text-indigo-400 block">
                {ticket.category}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">SLA Resolution Target</span>
              <span className={`font-mono font-medium block ${ticket.slaBreached ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-zinc-300'}`}>
                {ticket.slaDueTime ? new Date(ticket.slaDueTime).toLocaleDateString() : 'Within 24h'}
              </span>
            </div>
          </div>

          {/* Assignment Control */}
          <div className="p-4 rounded-xl border border-slate-300 dark:border-zinc-800 flex items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-0.5">Assigned Agent</span>
              <div className="flex items-center gap-2">
                {assignee ? (
                  <>
                    <img src={assignee.avatar} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />
                    <span className="font-semibold text-slate-900 dark:text-zinc-100">{assignee.name}</span>
                    <RoleBadge role={assignee.role} size="xs" />
                  </>
                ) : (
                  <span className="text-amber-600 font-medium">Unassigned</span>
                )}
              </div>
            </div>

            {canAssignTickets(currentUser) && (
              <select
                id="ticket-assign-agent-select"
                value={ticket.assignedToId || ''}
                onChange={(e) => assignTicket(ticket.id, e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
              >
                <option value="">Reassign Agent...</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({(u.role || '').replace('_', ' ')})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Escalation Control */}
          {canEscalateTicket(currentUser, ticket) && (
            <div className="p-4 rounded-xl bg-amber-100/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900 flex items-center justify-between text-xs">
              <div>
                <span className="font-semibold text-amber-900 dark:text-amber-200 block">
                  Incident Escalation
                </span>
                <span className="text-[11px] text-amber-800 dark:text-amber-400">
                  Escalate this ticket up the hierarchy for urgent management attention.
                </span>
              </div>
              <button
                id="trigger-escalate-modal-btn"
                onClick={() => setShowEscalateModal(true)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold flex items-center gap-1 shadow-xs cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> Escalate
              </button>
            </div>
          )}

          {/* Responses & Private Notes History */}
          <div className="space-y-4 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              Conversation Thread & Internal Notes ({ticketResponses.length})
            </h3>

            <div className="space-y-3">
              {ticketResponses.map(resp => (
                <div
                  key={resp.id}
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    resp.isInternalNote
                      ? 'bg-amber-100/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-900/60'
                      : 'bg-slate-100 dark:bg-zinc-900/50 border-slate-300 dark:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <img src={resp.authorAvatar} alt={resp.authorName} className="w-5 h-5 rounded-full object-cover" />
                      <span className="font-semibold text-slate-900 dark:text-zinc-100">{resp.authorName}</span>
                      <RoleBadge role={resp.authorRole} size="xs" />
                      {resp.isInternalNote && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-200/80 dark:bg-amber-900/60 px-1.5 py-0.2 rounded">
                          <Lock className="w-2.5 h-2.5" /> Internal Staff Note
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                      {new Date(resp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-800 dark:text-zinc-300 pl-7 leading-relaxed whitespace-pre-wrap">
                    {resp.content}
                  </p>
                </div>
              ))}
            </div>

            {/* Reply Composer */}
            <form onSubmit={handleSendResponse} className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs px-1">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-zinc-300">
                    <input
                      type="radio"
                      name="response-type"
                      checked={!isInternalNote}
                      onChange={() => setIsInternalNote(false)}
                      className="text-indigo-600 focus:ring-0"
                    />
                    <Globe className="w-3.5 h-3.5 text-indigo-500" /> Public Customer Reply
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-zinc-300">
                    <input
                      type="radio"
                      name="response-type"
                      checked={isInternalNote}
                      onChange={() => setIsInternalNote(true)}
                      className="text-amber-600 focus:ring-0"
                    />
                    <Lock className="w-3.5 h-3.5 text-amber-500" /> Private Internal Note
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <textarea
                  id="ticket-reply-textarea"
                  rows={2}
                  placeholder={isInternalNote ? 'Write internal note for supervisors & admins...' : 'Type public response to requester...'}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  className={`flex-1 p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-1 ${
                    isInternalNote
                      ? 'border-amber-300 dark:border-amber-800 bg-amber-100/30 dark:bg-amber-950/20 focus:ring-amber-500'
                      : 'border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:ring-indigo-500'
                  }`}
                />
                <button
                  id="ticket-send-reply-btn"
                  type="submit"
                  className={`px-4 text-xs font-semibold rounded-xl text-white flex items-center justify-center gap-1 shadow-xs transition cursor-pointer ${
                    isInternalNote ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-950 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium">Ticket State:</span>
            <select
              id="ticket-status-select"
              value={ticket.status}
              onChange={(e) => updateTicketStatus(ticket.id, e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold focus:outline-hidden"
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="pending_customer">Pending Customer</option>
              <option value="escalated">Escalated</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {ticket.status !== 'resolved' && (
              <button
                id="ticket-quick-resolve-btn"
                onClick={() => updateTicketStatus(ticket.id, 'resolved')}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Mark Resolved
              </button>
            )}
          </div>
        </div>

        {/* Escalation Prompt Modal */}
        {showEscalateModal && (
          <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-slate-200 dark:bg-zinc-950 rounded-xl p-5 border border-slate-300 dark:border-zinc-800 w-full max-w-md shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500" />
                  Escalate Ticket {ticket.ticketNumber}
                </h3>
                <button onClick={() => setShowEscalateModal(false)} className="text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-zinc-300 block mb-1">
                  Reason for escalation
                </label>
                <textarea
                  id="escalate-reason-input"
                  rows={3}
                  placeholder="Explain why this requires senior management intervention..."
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowEscalateModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="confirm-escalate-supervisor-btn"
                  onClick={() => handleEscalate('supervisor')}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg cursor-pointer"
                >
                  To Supervisor
                </button>
                <button
                  id="confirm-escalate-admin-btn"
                  onClick={() => handleEscalate('admin')}
                  className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer"
                >
                  To Admin
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};