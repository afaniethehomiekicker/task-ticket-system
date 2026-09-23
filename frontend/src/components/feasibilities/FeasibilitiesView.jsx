import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Search, Filter, Plus, Download, ArrowUpDown, Building, User as UserIcon, Pin, 
  Network, Globe, RadioTower, Zap, Truck, Box, AlertTriangle, ChevronDown
} from 'lucide-react';
import { PriorityBadge } from '../common/Badge';

import { FeasibilityDetailDrawer } from './FeasibilityDetailDrawer';
import { FeasibilityEditModal } from './FeasibilityEditModal';

const PRODUCTS = ['DPLC', 'Dark Fiber', 'IPT', 'IPT Mix', 'Pure IPT'];
const STATUSES = ['draft', 'in_progress', 'feasible', 'not_feasible', 'converted', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'critical'];

const getProductIcon = (product) => {
  switch (product) {
    case 'DPLC': return <RadioTower className="w-4 h-4" />;
    case 'Dark Fiber': return <Globe className="w-4 h-4" />;
    case 'IPT': return <Zap className="w-4 h-4" />;
    case 'IPT Mix': return <Network className="w-4 h-4" />;
    case 'Pure IPT': return <Box className="w-4 h-4" />;
    default: return <Network className="w-4 h-4" />;
  }
};

const getStatusColor = (status) => {
  switch (status) {
    case 'draft': return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300';
    case 'in_progress': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
    case 'feasible': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'not_feasible': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    case 'converted': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300';
    case 'cancelled': return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300';
  }
};

export const FeasibilitiesView = () => {
  const { 
    visibleFeasibilities, 
    allUsers, 
    clients,
    currentUser, 
    setSelectedFeasibilityId, 
    setSelectedFeasibilityEditId,
    openQuickCreate,
    createFeasibility
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('targetDate');

  // Extract unique cities from feasibilities for filter dropdown
  const cities = useMemo(() => {
    const citySet = new Set();
    visibleFeasibilities.forEach(f => {
      if (f.city) citySet.add(f.city);
    });
    return Array.from(citySet).sort();
  }, [visibleFeasibilities]);

  const filteredFeasibilities = useMemo(() => {
    return visibleFeasibilities.filter(f => {
      const matchSearch = f.feasibilityNumber.toLowerCase().includes(search.toLowerCase()) || 
                          f.product.toLowerCase().includes(search.toLowerCase()) ||
                          f.city.toLowerCase().includes(search.toLowerCase()) ||
                          f.requirementDetails.toLowerCase().includes(search.toLowerCase()) ||
                          (f.client?.companyName && f.client.companyName.toLowerCase().includes(search.toLowerCase()));
      const matchStatus = statusFilter === 'all' || f.status === statusFilter;
      const matchProduct = productFilter === 'all' || f.product === productFilter;
      const matchCity = cityFilter === 'all' || f.city === cityFilter;
      const matchAssignee = assigneeFilter === 'all' || f.assignedUserId === assigneeFilter;

      return matchSearch && matchStatus && matchProduct && matchCity && matchAssignee;
    }).sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      if (sortBy === 'targetDate') {
        return (a.targetDate ? new Date(a.targetDate).getTime() : 0) - (b.targetDate ? new Date(b.targetDate).getTime() : 0);
      }
      if (sortBy === 'priority') {
        const order = { critical: 4, high: 3, normal: 2, low: 1 };
        return order[b.priority] - order[a.priority];
      }
      if (sortBy === 'status') {
        const statusOrder = { converted: 6, feasible: 5, in_progress: 4, not_feasible: 3, draft: 2, cancelled: 1 };
        return statusOrder[b.status] - statusOrder[a.status];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [visibleFeasibilities, search, statusFilter, productFilter, cityFilter, assigneeFilter, sortBy]);

  return (
    <div id="feasibilities-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Feasibility Management
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Multi-vendor feasibility checks, evidence tracking, and one-click project conversion.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="create-feasibility-main-btn"
            onClick={() => openQuickCreate({ tab: 'feasibility', restrictToTab: true })}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Feasibility
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="feasibilities-search-input"
            type="text"
            placeholder="Search by ID, product, city, client, details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 placeholder-slate-500 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition"
          />
        </div>

        <select
          id="feasibilities-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
        >
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>

        <select
          id="feasibilities-product-filter"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
        >
          <option value="all">All Products</option>
          {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          id="feasibilities-city-filter"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
        >
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          id="feasibilities-assignee-filter"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
        >
          <option value="all">All Assignees</option>
          {allUsers.filter(u => u.role === 'staff' || u.role === 'supervisor').map(u => (
            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
          ))}
        </select>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-slate-500 dark:text-zinc-400">Sort:</span>
          <select
            id="feasibilities-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
          >
            <option value="targetDate">Target Date</option>
            <option value="priority">Priority</option>
            <option value="status">Status</option>
            <option value="created">Newest First</option>
          </select>
        </div>
      </div>

      {/* Feasibility Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredFeasibilities.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <Network className="w-16 h-16 mx-auto text-slate-300 dark:text-zinc-700 mb-4" />
            <h3 className="text-lg font-medium text-slate-900 dark:text-zinc-100 mb-1">No feasibilities found</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400">Adjust filters or create a new feasibility request.</p>
          </div>
        ) : (
          filteredFeasibilities.map(f => (
            <FeasibilityCard 
              key={f.id} 
              feasibility={f} 
              onClick={() => setSelectedFeasibilityId(f.id)}
            />
          ))
        )}
      </div>

      <FeasibilityDetailDrawer />
      <FeasibilityEditModal />
    </div>
  );
};

const FeasibilityCard = ({ feasibility, onClick }) => {
  const client = feasibility.client;
  const vendorCount = feasibility.vendors?.length || 0;
  const feasibleCount = feasibility.vendors?.filter(v => v.status === 'feasible').length || 0;
  
  return (
    <div 
      id={`feasibility-card-${feasibility.id}`}
      className={`p-4 rounded-xl border transition-all cursor-pointer hover:shadow-lg ${
        feasibility.isPinned 
          ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20' 
          : 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 hover:border-indigo-300 dark:hover:border-indigo-800'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/80 px-2 py-0.5 rounded whitespace-nowrap">
            {feasibility.feasibilityNumber}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(feasibility.status)} whitespace-nowrap`}>
            {feasibility.status.replace('_', ' ')}
          </span>
        </div>
        {feasibility.isPinned && (
          <Pin className="w-4 h-4 text-amber-500 shrink-0" title="Pinned" />
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-slate-900 dark:text-zinc-100 font-medium truncate">
          {getProductIcon(feasibility.product)}
          <span className="truncate">{feasibility.product}</span>
          {feasibility.capacity && (
            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-zinc-800 rounded text-xs text-slate-600 dark:text-slate-400">
              {feasibility.capacity}
            </span>
          )}
        </div>

        {client && (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 truncate">
            <Building className="w-4 h-4 shrink-0" />
            <span className="truncate">{client.companyName}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 truncate">
          <Truck className="w-4 h-4 shrink-0" />
          <span className="truncate">{feasibility.city || '—'}</span>
        </div>

        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 truncate">
          <UserIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">{feasibility.assignedUser?.name || 'Unassigned'}</span>
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <AlertTriangle className="w-3 h-3" />
            <span>{vendorCount} vendor{vendorCount !== 1 ? 's' : ''}</span>
            {feasibleCount > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                ({feasibleCount} feasible)
              </span>
            )}
          </div>
          {feasibility.targetDate && (
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Due: {new Date(feasibility.targetDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};