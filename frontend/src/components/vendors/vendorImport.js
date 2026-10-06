// Spreadsheet import settings for the vendor master (see
// ImportSpreadsheetModal). The server (POST /api/vendors/import) checks every
// row and saves the valid ones in one transaction. Vendor names are unique,
// so rows matching an existing vendor, active or archived, are always skipped.

const COLUMNS = [
  { key: 'name', label: 'Vendor name', required: true, width: 30,
    aliases: ['name', 'vendor', 'company', 'company name', 'supplier', 'supplier name', 'provider', 'service provider'],
    hint: 'Must be unique. Rows matching an existing vendor are skipped. Max 150 characters.', example: 'Example Fiber Services' },
  { key: 'contact_person', label: 'Contact person', width: 22,
    aliases: ['contact', 'poc', 'point of contact', 'focal person', 'contact name'], example: 'Usman Tariq' },
  { key: 'phone', label: 'Phone', text: true, width: 16,
    aliases: ['phone number', 'phone no', 'mobile', 'mobile number', 'cell', 'telephone', 'tel', 'contact number'],
    hint: 'Format the column as Text in Excel so a leading 0 is kept.', example: '03001234567' },
  { key: 'email', label: 'Email', width: 28, aliases: ['email address', 'e-mail', 'mail'], example: 'noc@example.com' },
  { key: 'cities', label: 'Cities covered', width: 30,
    aliases: ['cities', 'city', 'areas', 'areas covered', 'coverage', 'locations', 'regions'],
    hint: 'Comma-separated.', example: 'Islamabad, Lahore' },
  { key: 'services', label: 'Services', width: 30,
    aliases: ['service', 'services offered', 'products', 'service type'],
    hint: 'Comma-separated.', example: 'DPLC, Dark Fiber, IPT' },
  { key: 'notes', label: 'Notes', width: 34, aliases: ['remarks', 'comments', 'note', 'description'] },
];

export function buildVendorImportConfig() {
  return {
    entityLabel: 'vendor',
    entityLabelPlural: 'vendors',
    sheetName: 'Vendors',
    templateFileName: 'vendors-import-template.xlsx',
    problemsFileName: 'vendors-not-imported.xlsx',
    templateIntro: 'Fill one vendor per row on the Vendors sheet, starting on row 2. Vendor name is required; leave other columns blank if you do not have the information. Keep the headings as they are; you can delete columns you do not use.',
    columns: COLUMNS,
    previewColumns: ['name', 'contact_person', 'phone', 'email', 'cities'],
    toRequestRow: ({ row, values }) => ({ row, ...values }),
    allowDuplicateOverride: false,
    endpoint: '/api/vendors/import',
  };
}
