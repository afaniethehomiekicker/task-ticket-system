// Spreadsheet import settings for clients (see ImportSpreadsheetModal). The
// server (POST /api/clients/import) checks every row and saves the valid ones
// in one transaction; this file only says which columns exist and how a
// spreadsheet row becomes a request row.

const BASE_COLUMNS = [
  { key: 'company_name', label: 'Company name', required: true, width: 30,
    aliases: ['company', 'name', 'company / organization', 'organization', 'organisation', 'business name', 'customer', 'client company'],
    hint: 'The company or organization. Rows whose name matches an existing client are skipped.',
    example: 'Example Networks (Pvt) Ltd' },
  { key: 'client_name', label: 'Client name', width: 22,
    aliases: ['client', 'person name', 'customer name', 'full name', 'contact name'],
    hint: "The client's own name (a person).", example: 'Ali Khan' },
  { key: 'cnic', label: 'CNIC', text: true, width: 18,
    aliases: ['cnic number', 'cnic no', 'nic', 'nic number'],
    hint: '13 digits, with or without dashes.', example: '12345-1234567-1' },
  { key: 'mobile', label: 'Mobile', text: true, width: 16,
    aliases: ['mobile number', 'mobile no', 'cell', 'cell number', 'cell no', 'whatsapp'],
    hint: 'Format the column as Text in Excel so a leading 0 is kept.', example: '03001234567' },
  { key: 'contact_person', label: 'Contact person', width: 22,
    aliases: ['contact', 'poc', 'point of contact', 'focal person'], example: 'Sara Ahmed' },
  { key: 'email', label: 'Email', width: 28,
    aliases: ['email address', 'e-mail', 'mail'], example: 'info@example.com' },
  { key: 'phone', label: 'Phone', text: true, width: 16,
    aliases: ['phone number', 'phone no', 'telephone', 'tel', 'landline', 'office phone'], example: '0512345678' },
  { key: 'website', label: 'Website', width: 24,
    aliases: ['web', 'url', 'site', 'web site', 'web address'], example: 'www.example.com' },
  { key: 'industry', label: 'Industry', width: 18, aliases: ['sector', 'business type'], example: 'Banking' },
  { key: 'address', label: 'Address', width: 34, aliases: ['street address', 'office address', 'location'] },
  { key: 'city', label: 'City', width: 14, aliases: ['town'], example: 'Islamabad' },
  { key: 'country', label: 'Country', width: 14, example: 'Pakistan' },
  { key: 'status', label: 'Status', width: 12, aliases: ['client status'],
    hint: 'active or inactive. Leave blank for active.', example: 'active' },
  { key: 'notes', label: 'Notes', width: 34, aliases: ['remarks', 'comments', 'note', 'description'] },
];

const CUSTOM_PREFIX = 'custom:';

export function buildClientImportConfig({ clientFields }) {
  const custom = (clientFields || []).filter(f => f.enabled);
  const columns = [
    ...BASE_COLUMNS,
    ...custom.map(f => ({
      key: CUSTOM_PREFIX + f.key,
      label: f.label,
      // Required custom fields are checked per row by the server; the column
      // itself isn't demanded, so the message says which rows lack a value.
      aliases: [f.key],
      width: 18,
      hint: [
        f.required ? 'Required.' : '',
        f.fieldType === 'select' ? `One of: ${f.options.join(', ')}`
          : f.fieldType === 'date' ? 'A date (an Excel date cell, or YYYY-MM-DD).'
          : f.fieldType === 'number' ? 'A number.' : '',
      ].filter(Boolean).join(' '),
      example: f.fieldType === 'select' ? (f.options[0] || '')
        : f.fieldType === 'date' ? '2026-01-31'
        : f.fieldType === 'number' ? '100' : '',
    })),
  ];

  // One spreadsheet row -> one row of the import request.
  const toRequestRow = ({ row, values }) => {
    const out = { row, custom_fields: {} };
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith(CUSTOM_PREFIX)) {
        if (value !== '') out.custom_fields[key.slice(CUSTOM_PREFIX.length)] = value;
      } else {
        out[key] = value;
      }
    }
    return out;
  };

  return {
    entityLabel: 'client',
    entityLabelPlural: 'clients',
    sheetName: 'Clients',
    templateFileName: 'clients-import-template.xlsx',
    problemsFileName: 'clients-not-imported.xlsx',
    templateIntro: 'Fill one client per row on the Clients sheet, starting on row 2. Company name is required, and so are any fields marked "Required." above. Leave other columns blank if you do not have the information. Keep the headings as they are; you can delete columns you do not use.',
    columns,
    previewColumns: ['company_name', 'client_name', 'email', 'mobile', 'city'],
    toRequestRow,
    // Different clients can share a company name (e.g. branches), so the
    // person importing may choose to import those rows anyway.
    allowDuplicateOverride: true,
    endpoint: '/api/clients/import',
  };
}
