// Display data for client products & services (client CRM step 2). Keys
// match internal/handlers/client_services.go.

export const SERVICE_STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  suspended: { label: 'Suspended', cls: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' },
  closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' },
};

export const SERVICE_ARRANGEMENT = {
  through_us: {
    label: 'Through our company',
    short: 'Through us',
    hint: 'We provide the vendor\'s service to the client',
    cls: 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  },
  direct: {
    label: 'Direct with client',
    short: 'Direct with client',
    hint: 'The client buys it directly from the vendor',
    cls: 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  },
};

// Labels for the change history.
export const SERVICE_FIELD_LABELS = {
  product: 'Product / service',
  location: 'Location',
  capacity: 'Capacity / package',
  vendor: 'Vendor',
  arrangement: 'Vendor arrangement',
  activation_date: 'Activation date',
  status: 'Status',
  ticket: 'Related ticket',
  notes: 'Notes',
};

