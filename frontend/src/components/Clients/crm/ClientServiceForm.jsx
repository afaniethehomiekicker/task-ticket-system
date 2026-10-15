import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useAppSelector } from '../../../context/AppContext';
import { useVendorList, findVendorByName, invalidateVendorList } from '../../vendors/vendorList';
import { feasibilityProductOptions, matchExistingProduct, MAX_PRODUCT_LENGTH } from '../../../utils/feasibilityProducts';
import { ClientTicketPicker } from './ClientTicketPicker';
import { SERVICE_STATUS, SERVICE_ARRANGEMENT } from './serviceMeta';

// Add or edit one client product / service (client CRM step 2).
// The server checks everything again (client_services.go).

const EXTRA_PRODUCTS = ['Hosting'];

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden';
const labelCls = 'block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5';

const fromService = (s) => ({
  product: s?.product || 'IPT',
  capacity: s?.capacity || '',
  location: s?.location || '',
  vendorName: s?.vendor_name || '',
  arrangement: s?.arrangement || '',
  activationDate: s?.activation_date ? String(s.activation_date).slice(0, 10) : '',
  status: s?.status || 'pending',
  notes: s?.notes || '',
});

export const ClientServiceForm = ({ clientId, service, onClose, onSaved }) => {
  const { apiFetch, feasibilityProducts } = useAppSelector(s => ({ apiFetch: s.apiFetch, feasibilityProducts: s.feasibilityProducts }));
  const vendorList = useVendorList(apiFetch);
  const [form, setForm] = useState(() => fromService(service));
  const [ticket, setTicket] = useState(() => (service?.ticket_id
    ? { id: service.ticket_id, ticketNumber: service.ticket_number, title: '', status: '' }
    : null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Fresh vendor list each time the form opens.
  useEffect(() => { invalidateVendorList(); }, []);

  // Products: the standard / feasibility ones, Hosting, every product
  // already used on a client service, and this service's own product.
  const [serviceProducts, setServiceProducts] = useState([]);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/clients/service-products')
      .then(r => (r.ok ? r.json() : { products: [] }))
      .then(d => { if (alive) setServiceProducts(d.products || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [apiFetch]);
  const productOptions = feasibilityProductOptions([
    ...(feasibilityProducts || []), ...EXTRA_PRODUCTS, ...serviceProducts, ...(service?.product ? [service.product] : []),
  ]);
  // "New product (not in the list)", as on the feasibility form.
  const [newProduct, setNewProduct] = useState(false);
  const [customProduct, setCustomProduct] = useState('');
  const chosenProduct = newProduct ? matchExistingProduct(customProduct, productOptions) : form.product;
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Unchanged vendor on an existing service stays linked by id, even if
  // it's been archived since; anything else is matched by name.
  const keepsVendor = !!service?.vendor_id && form.vendorName.trim().toLowerCase() === (service.vendor_name || '').toLowerCase();
  const pickedVendor = keepsVendor ? null : findVendorByName(vendorList, form.vendorName);
  const hasVendor = !!form.vendorName.trim();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!chosenProduct.trim()) { setError(newProduct ? 'Type the new product / service name' : 'Product / service is required'); return; }
    if (hasVendor && !form.arrangement) { setError('Choose whether the vendor service is through our company or direct with the client'); return; }

    const body = {
      product: chosenProduct.trim(),
      capacity: form.capacity.trim(),
      location: form.location.trim(),
      vendor_id: keepsVendor ? service.vendor_id : (pickedVendor?.id || null),
      vendor_name: form.vendorName.trim(),
      arrangement: hasVendor ? form.arrangement : '',
      activation_date: form.activationDate || '',
      status: form.status,
      ticket: ticket?.ticketNumber || '',
      notes: form.notes.trim(),
    };
    setSaving(true);
    try {
      const res = await apiFetch(service ? `/api/clients/${clientId}/services/${service.id}` : `/api/clients/${clientId}/services`, {
        method: service ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save the service');
        return;
      }
      if (hasVendor && !pickedVendor && !keepsVendor) invalidateVendorList(); // a new vendor was added
      onSaved(data.service);
    } catch {
      setError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-lg rounded-xl overflow-hidden border border-slate-300 dark:border-zinc-800 bg-slate-200 dark:bg-zinc-950 shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {service ? `Edit service ${service.service_number}` : 'Add product / service'}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-300 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={newProduct}
              onChange={(e) => setNewProduct(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            New product / service <span className="text-xs text-slate-500 dark:text-zinc-500">(not in the list)</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Product / service <span className="text-rose-500">*</span></label>
              {newProduct ? (
                <input
                  autoFocus
                  value={customProduct}
                  onChange={(e) => setCustomProduct(e.target.value)}
                  maxLength={MAX_PRODUCT_LENGTH}
                  placeholder="Type the product / service name"
                  className={inputCls}
                />
              ) : (
                <select value={form.product} onChange={set('product')} className={inputCls}>
                  {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {newProduct && customProduct.trim() && chosenProduct !== customProduct.trim() && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">Already in the list as “{chosenProduct}” — that will be used.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Capacity / package</label>
              <input value={form.capacity} onChange={set('capacity')} maxLength={100} placeholder="e.g. 1 Gbps" className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Service location</label>
            <input value={form.location} onChange={set('location')} maxLength={255} placeholder="Site / city / address" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Vendor</label>
            <input list="client-service-vendors" value={form.vendorName} onChange={set('vendorName')} maxLength={150}
              placeholder="Pick from the vendor list or type a new name (leave empty if none)" className={inputCls} autoComplete="off" />
            <datalist id="client-service-vendors">
              {vendorList.map(v => (
                <option key={v.id} value={v.name}>{[v.vendorNumber, v.cities].filter(Boolean).join(' · ')}</option>
              ))}
            </datalist>
            {hasVendor && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                {keepsVendor ? 'Current vendor.' : pickedVendor ? `From the vendor list (${pickedVendor.vendorNumber}).` : 'New vendor — it will be added to the vendor list.'}
              </p>
            )}
          </div>

          {hasVendor && (
            <div>
              <label className={labelCls}>Vendor arrangement <span className="text-rose-500">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SERVICE_ARRANGEMENT).map(([key, meta]) => (
                  <label key={key}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer text-xs ${form.arrangement === key
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                      : 'border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900'}`}>
                    <input type="radio" name="arrangement" value={key} checked={form.arrangement === key}
                      onChange={set('arrangement')} className="mt-0.5" />
                    <span>
                      <span className="block font-semibold text-slate-800 dark:text-zinc-100">{meta.label}</span>
                      <span className="text-slate-500 dark:text-zinc-400">{meta.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Activation date</label>
              <input type="date" value={form.activationDate} onChange={set('activationDate')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={set('status')} className={inputCls}>
                {Object.entries(SERVICE_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <ClientTicketPicker clientId={clientId} value={ticket} onChange={setTicket} label="Related ticket (optional)" allowNewTicket={false} />

          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={5000}
              placeholder="Anything else about this service" className={`${inputCls} resize-none`} />
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-300 dark:border-zinc-800">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer">Cancel</button>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg cursor-pointer">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {service ? 'Save changes' : 'Add service'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClientServiceForm;
