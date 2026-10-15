import React from 'react';
import { Server, Users } from 'lucide-react';
import { PlanSwitch, SERVICE_COLUMN } from './PlanSwitch';
import { ipWarning, vlanWarning, duplicateWarning } from './networkValidation';

// A client's Transmission tab: two sheets behind one switch —
//   Core    the client's core / POP devices, with the encrypted password
//           (hidden by default, shown only with "View Transmission Plan
//           Passwords"; each reveal is logged). Not linked to a service.
//   Client  the client's end connections (VLAN ranges, user IDs,
//           transmission paths); every row belongs to one of the client's
//           services.
// Column keys match transmissionPlanDef / clientTransmissionPlanDef in
// internal/handlers/client_plans.go.

export const CORE_TRANSMISSION_COLUMNS = [
  { key: 'sr', label: 'SR', width: 110, placeholder: 'e.g. GTR-C12', mono: true, validate: duplicateWarning('sr', 'SR') },
  { key: 'hostname', label: 'Hostname', width: 220, placeholder: 'e.g. GTR-DASKA-NX | Yasir-POP' },
  { key: 'mgmt_vlan_plan', label: 'MGM-VLAN202-Plan', width: 160, placeholder: 'e.g. 10.10.202.12/24', mono: true, validate: (v) => ipWarning(v) },
  { key: 'mgmt_ip_vlan', label: 'IP (MGM) VLAN', width: 160, placeholder: 'e.g. 172.16.201.12/24', mono: true, validate: (v) => ipWarning(v) },
  { key: 'username', label: 'Username', width: 110, mono: true },
  { key: 'password', label: 'Password', width: 170, secret: true },
  { key: 'transmission_details', label: 'Transmission Details', width: 380, placeholder: 'e.g. C12-NX-eth1/1---C11-eth1/2…', mono: true, multiline: true },
];

export const CLIENT_TRANSMISSION_COLUMNS = [
  SERVICE_COLUMN,
  { key: 'date', label: 'Date', width: 105, placeholder: 'e.g. 28-Sep-2026' },
  { key: 'sr', label: 'SR', width: 60 },
  { key: 'vlan', label: 'VLAN', width: 130, placeholder: 'e.g. 2351-2370', mono: true, validate: (v) => vlanWarning(String(v).replace(/\s*\|\s*/g, ',')) },
  { key: 'client_name', label: 'Client Name', width: 160, placeholder: 'e.g. Yasir Mughal' },
  { key: 'user_id', label: 'User-ID', width: 120, placeholder: 'e.g. yasir052', mono: true, validate: duplicateWarning('user_id', 'User-ID') },
  { key: 'location', label: 'Location', width: 130, placeholder: 'e.g. DASKA' },
  { key: 'transmission_a', label: 'Transmission A', width: 260, placeholder: 'e.g. C11-NX-eth1/140', mono: true },
  { key: 'transmission_b', label: 'Transmission B', width: 220, mono: true },
  { key: 'other_details', label: 'Other Details', width: 200, multiline: true },
];

const VIEWS = [
  {
    key: 'transmission', label: 'Core', icon: Server, title: 'Core Transmission Plan',
    recordType: 'transmission_plan', columns: CORE_TRANSMISSION_COLUMNS,
  },
  {
    key: 'tx_client', label: 'Client', icon: Users, title: 'Client Transmission Plan',
    recordType: 'client_transmission_plan', columns: CLIENT_TRANSMISSION_COLUMNS,
  },
];

export const TransmissionPlanSheet = ({ clientId, clientName, onOpenTicket, onDirtyChange }) => (
  <PlanSwitch views={VIEWS} clientId={clientId} clientName={clientName} onOpenTicket={onOpenTicket} onDirtyChange={onDirtyChange} />
);

export default TransmissionPlanSheet;
