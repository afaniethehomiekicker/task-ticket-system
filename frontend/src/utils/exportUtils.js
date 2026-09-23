export function exportToCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const separator = ',';
  const keys = Object.keys(rows[0]);
  
  const csvContent =
    keys.map(k => `"${k}"`).join(separator) +
    '\n' +
    rows.map(row => {
      return keys
        .map(k => {
          let cell = row[k] === null || row[k] === undefined ? '' : row[k];
          cell = cell instanceof Date
            ? cell.toLocaleString()
            : typeof cell === 'object'
            ? JSON.stringify(cell).replace(/"/g, '""')
            : cell.toString().replace(/"/g, '""');
          return `"${cell}"`;
        })
        .join(separator);
    }).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportAuditLogsToCSV(logs) {
  // Defensively guarded, not fixed — AppContext.jsx's fetchAuditLogs sets
  // audit logs directly from the backend response with NO normalization
  // step (unlike users/projects/tasks/tickets, which each go through a
  // dedicated normalizeX function specifically to handle this exact kind
  // of naming mismatch). Field names below (actorName, actorRole,
  // entityType, entityId, timestamp) are a guess based on the OLD
  // frontend-only audit log shape — if the real backend response uses Go
  // convention names instead (user_id, resource_type, resource_id,
  // created_at — matching database/audit.go's LogAction, which is the
  // only audit-writing code seen so far), every one of these would be
  // undefined. Previously that meant calling .toUpperCase() on undefined
  // and crashing the export entirely; now it produces a blank cell
  // instead. The real fix is normalizing audit logs properly once the
  // actual response shape is confirmed — this only prevents a crash in
  // the meantime.
  const data = logs.map(l => ({
    'Timestamp': l.timestamp ? new Date(l.timestamp).toLocaleString() : '',
    'Actor': l.actorName || '',
    'Actor Role': (l.actorRole || '').toUpperCase(),
    'Entity Type': (l.entityType || '').toUpperCase(),
    'Entity ID': l.entityId ?? '',
    'Action': (l.action || '').toUpperCase(),
    'Details': l.details || ''
  }));

  exportToCSV(`Audit_Logs_Export_${new Date().toISOString().split('T')[0]}`, data);
}

export function exportTasksToCSV(tasks, users, projects) {
  const userMap = new Map(users.map(u => [u.id, u.name]));
  const projectMap = new Map(projects.map(p => [p.id, p.title]));

  const data = tasks.map(t => ({
    'Task #': t.taskNumber,
    'Title': t.title,
    'Project': projectMap.get(t.projectId) || 'None',
    'Department': t.department,
    'Assignee': userMap.get(t.assignedToId) || 'Unassigned',
    'Status': t.status.toUpperCase(),
    'Priority': t.priority.toUpperCase(),
    'Progress %': t.progress,
    'Start Date': t.startDate,
    'Due Date': t.dueDate,
    'Est Hours': t.estimatedHours,
    'Actual Hours': t.actualHours,
    'Review Status': t.reviewStatus,
    'Labels': t.labels.join('; ')
  }));

  exportToCSV(`Tasks_Export_${new Date().toISOString().split('T')[0]}`, data);
}

export function exportTicketsToCSV(tickets, users) {
  const userMap = new Map(users.map(u => [u.id, u.name]));

  const data = tickets.map(t => ({
    'Ticket #': t.ticketNumber,
    'Title': t.title,
    'Category': t.category,
    'Department': t.department,
    'Requester': t.requesterName,
    'Requester Email': t.requesterEmail,
    'Assignee': userMap.get(t.assignedToId) || 'Unassigned',
    'Status': t.status.toUpperCase(),
    'Priority': t.priority.toUpperCase(),
    'Severity': t.severity.toUpperCase(),
    'Escalation Level': t.escalationLevel,
    'Due Date': t.dueDate,
    'Response SLA (mins)': t.responseSlaMinutes,
    'Resolution SLA (mins)': t.resolutionSlaMinutes,
    'Created At': t.createdAt
  }));

  exportToCSV(`Tickets_Export_${new Date().toISOString().split('T')[0]}`, data);
}

export function exportProjectsToCSV(projects, users) {
  const userMap = new Map(users.map(u => [u.id, u.name]));

  const data = projects.map(p => ({
    'Code': p.code,
    'Title': p.title,
    'Department': p.department,
    'Owner': userMap.get(p.ownerId) || 'Unassigned',
    'Status': p.status.toUpperCase(),
    'Priority': p.priority.toUpperCase(),
    'Progress %': p.progress,
    'Budget Hours': p.budgetHours,
    'Spent Hours': p.spentHours,
    'Start Date': p.startDate,
    'Due Date': p.dueDate
  }));

  exportToCSV(`Projects_Export_${new Date().toISOString().split('T')[0]}`, data);
}