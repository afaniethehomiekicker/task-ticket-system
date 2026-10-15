import React from 'react';
import { Network, Share2 } from 'lucide-react';
import { PlanSwitch, SERVICE_COLUMN } from './PlanSwitch';
import { ipWarning, vlanWarning, duplicateWarning, allOf } from './networkValidation';

// A client's IP Plan (client CRM): two sheets behind one switch —
//   Static IP  the team's IP plan sheet (Site ID, P2P IPs, static route…)
//   BGP        for clients that peer with us over BGP (ASN, prefixes, AS path…)
// Every row of both belongs to one of the client's services (required).
// Column keys match ipPlanDef / bgpPlanDef in internal/handlers/client_plans.go.


export const IP_PLAN_COLUMNS = [
  SERVICE_COLUMN,
  { key: 'site_id', label: 'Site ID', width: 190, placeholder: 'e.g. LLB995 | PTCL Ex Wazirabad' },
  {
    key: 'gateway_end', label: 'P2P IP Gateway End', width: 170, placeholder: 'e.g. 160.30.109.16/31', mono: true,
    validate: allOf((v) => ipWarning(v), duplicateWarning('gateway_end', 'Gateway IP')),
  },
  {
    key: 'cp_end', label: 'P2P IP CP End', width: 170, placeholder: 'e.g. 160.30.109.17/31', mono: true,
    validate: allOf((v) => ipWarning(v), duplicateWarning('cp_end', 'CP IP')),
  },
  {
    key: 'static_route', label: 'Static Route', width: 170, placeholder: 'e.g. 160.30.109.0/28 or N/A', mono: true,
    validate: (v) => (/^n\/?a$/i.test(String(v).trim()) ? '' : ipWarning(v)),
  },
  { key: 'interface_vlan', label: 'Interface / VLAN', width: 130, placeholder: 'e.g. 180', mono: true },
  { key: 'capacity', label: 'Capacity', width: 110, placeholder: 'e.g. 1 Gbps' },
  { key: 'date', label: 'Date', width: 110, placeholder: 'e.g. 03-Aug-26' },
  { key: 'transmission_details', label: 'Transmission / Details', width: 220, placeholder: 'e.g. LLB995-DPLC-PTCL', multiline: true },
];

export const BGP_PLAN_COLUMNS = [
  SERVICE_COLUMN,
  { key: 'site_id', label: 'Site ID', width: 150, placeholder: 'e.g. IIB995' },
  { key: 'vlan', label: 'VLAN', width: 90, placeholder: 'e.g. 35', mono: true, validate: (v) => vlanWarning(v) },
  { key: 'provider_end_ip', label: 'Provider End IP', width: 160, placeholder: 'e.g. 10.248.8.4/31', mono: true, validate: (v) => ipWarning(v) },
  { key: 'our_end_ip', label: 'Our End IP', width: 160, placeholder: 'e.g. 10.248.8.5/31', mono: true, validate: (v) => ipWarning(v) },
  {
    key: 'asn', label: 'ASN', width: 100, placeholder: 'e.g. 150315', mono: true,
    validate: (v) => (!v || /^(AS)?\d{1,10}$/i.test(String(v).trim()) ? '' : 'ASN should be a number, e.g. 150315'),
  },
  { key: 'prefixes', label: 'Prefixes', width: 180, placeholder: 'one per line', mono: true, multiline: true, validate: (v) => ipWarning(v) },
  { key: 'as_path', label: 'AS Path', width: 230, placeholder: 'e.g. 17557 < 24499 < 150315 < 203391i', mono: true },
  { key: 'peering', label: 'Peering', width: 100, placeholder: 'e.g. 300' },
];

const VIEWS = [
  { key: 'ip', label: 'Static IP', icon: Network, title: 'IP Plan', recordType: 'ip_plan', columns: IP_PLAN_COLUMNS },
  { key: 'bgp', label: 'BGP', icon: Share2, title: 'BGP Plan', recordType: 'bgp_plan', columns: BGP_PLAN_COLUMNS },
];

export const IPPlanSheet = ({ clientId, clientName, onOpenTicket, onDirtyChange }) => (
  <PlanSwitch views={VIEWS} clientId={clientId} clientName={clientName} onOpenTicket={onOpenTicket} onDirtyChange={onDirtyChange} />
);

export default IPPlanSheet;
