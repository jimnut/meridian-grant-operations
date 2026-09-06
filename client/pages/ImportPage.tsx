import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, FileSpreadsheet, Upload } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { detectDelimiter, parseCsv } from '../../shared/csv';
import type { ImportResult } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Badge, Card, Field, Select, Textarea } from '../components/ui';

const FIELDS: Array<{ key: string; label: string; required?: boolean; hint: string }> = [
  { key: 'title', label: 'Grant title', required: true, hint: 'Required' },
  { key: 'funderName', label: 'Funder', required: true, hint: 'Required; created if new' },
  { key: 'funderType', label: 'Funder type', hint: 'Foundation, state, federal…' },
  { key: 'program', label: 'Program', hint: '' },
  { key: 'status', label: 'Status', hint: 'Awarded, Reporting, Submitted, Prospect…' },
  { key: 'requested', label: 'Requested amount', hint: '' },
  { key: 'awarded', label: 'Awarded amount', hint: 'Required for awarded grants' },
  { key: 'startDate', label: 'Period start', hint: 'YYYY-MM-DD or MM/DD/YYYY' },
  { key: 'endDate', label: 'Period end', hint: '' },
  { key: 'renewalDate', label: 'Renewal date', hint: '' },
  { key: 'reportTitle', label: 'Next report title', hint: '' },
  { key: 'reportDueDate', label: 'Next report due', hint: 'Creates a deliverable' },
  { key: 'ownerEmail', label: 'Owner email', hint: 'Must be a team member' },
  { key: 'purpose', label: 'Purpose', hint: '' },
  { key: 'notes', label: 'Notes', hint: '' },
];

const SYNONYMS: Record<string, string[]> = {
  title: ['title', 'grant title', 'grant name', 'grant', 'name', 'award', 'award name', 'project', 'project title', 'proposal'],
  funderName: ['funder', 'funder name', 'foundation', 'grantor', 'funding source', 'source', 'agency', 'donor', 'organization'],
  funderType: ['funder type', 'type', 'funder category'],
  program: ['program', 'programme', 'department', 'program area'],
  status: ['status', 'stage', 'grant status', 'state'],
  requested: ['requested', 'requested amount', 'amount requested', 'ask', 'request', 'request amount'],
  awarded: ['awarded', 'awarded amount', 'amount awarded', 'award amount', 'amount', 'grant amount', 'total', 'total award', 'funded amount'],
  startDate: ['start', 'start date', 'period start', 'grant start', 'begin', 'begin date', 'grant period start'],
  endDate: ['end', 'end date', 'period end', 'grant end', 'expiration', 'expires', 'grant period end'],
  renewalDate: ['renewal', 'renewal date', 'renewal due', 'renew by'],
  reportTitle: ['report title', 'next report', 'report name', 'report'],
  reportDueDate: ['report due', 'report due date', 'next report due', 'due date', 'report deadline', 'deadline', 'next deadline'],
  ownerEmail: ['owner email', 'owner', 'manager email', 'lead', 'assigned to', 'contact email'],
  purpose: ['purpose', 'description', 'summary', 'project description'],
  notes: ['notes', 'comments', 'comment', 'remarks'],
};

function normalize(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of FIELDS) {
    const candidates = SYNONYMS[field.key] ?? [];
    const match = headers.find((header) => !used.has(header) && candidates.includes(normalize(header)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

export function ImportPage() {
  const session = useCurrentSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    document.title = `Import grants · ${BRAND.titleSuffix}`;
  }, []);

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    const rows = parseCsv(raw, detectDelimiter(raw));
    if (rows.length === 0) return null;
    const headers = (rows[0] ?? []).map((h) => h.trim());
    const body = rows.slice(1);
    return { headers, body };
  }, [raw]);

  useEffect(() => {
    if (parsed) setMapping(autoMap(parsed.headers));
  }, [parsed]);

  const mappedRows = useMemo(() => {
    if (!parsed) return [];
    const index = new Map(parsed.headers.map((header, i) => [header, i] as const));
    return parsed.body.map((cells) => {
      const row: Record<string, string> = {};
      for (const field of FIELDS) {
        const header = mapping[field.key];
        if (!header) continue;
        const i = index.get(header);
        if (i === undefined) continue;
        row[field.key] = cells[i] ?? '';
      }
      return row;
    });
  }, [parsed, mapping]);

  const runImport = useMutation({
    mutationFn: (rows: Record<string, string>[]) => api.post<ImportResult>('/grants/import', { rows, createFunders: true }),
    onSuccess: async (data) => {
      setResult(data);
      trackEvent('import_grants', { created: data.created, errors: data.errors });
      await queryClient.invalidateQueries();
      if (data.created > 0) toast.success(`${data.created} grant${data.created === 1 ? '' : 's'} imported.`);
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'The import failed. Please try again.'),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setRaw(await file.text());
  };

  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key]);
  const canImport = parsed !== null && mappedRows.length > 0 && missingRequired.length === 0 && !runImport.isPending;
  const previewRows = mappedRows.slice(0, 5);

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{session.organization.name}</p>
          <h1 className="page-header__title">Import grants from a spreadsheet</h1>
          <p className="page-header__lede">
            Export your tracker as CSV, upload it here, check the column mapping and import. Funders are created when they do
            not exist yet, duplicates are skipped, and a next report date becomes a deliverable the risk rules can watch.
          </p>
        </div>
        <div className="page-header__actions">
          <a className="btn" href="/templates/grant-import-template.csv" download>
            <FileSpreadsheet size={16} aria-hidden="true" />
            Download template
          </a>
          <Link to="/grants" className="btn">
            Back to grants
          </Link>
        </div>
      </header>

      <div className="stack stack-5">
        <Card title="1. Choose a file" subtitle="CSV exported from Excel, Google Sheets, Airtable or another tool. Up to 500 rows per import.">
          <div className="stack stack-4">
            <label className="btn btn--primary" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
              <Upload size={16} aria-hidden="true" />
              {fileName ? `Replace ${fileName}` : 'Choose CSV file'}
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <Field label="Or paste the rows here" htmlFor="import-paste" optional hint="First row must be the column headings.">
              <Textarea
                id="import-paste"
                rows={6}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setFileName(null);
                  setResult(null);
                }}
                placeholder={'Grant title,Funder,Status,Awarded amount,Period start,Period end,Next report due\nYouth Mentoring,Harbor Light Foundation,Awarded,85000,2026-05-01,2027-04-30,2026-10-15'}
              />
            </Field>
            {parsed && (
              <p className="muted small">
                Found <strong>{parsed.body.length}</strong> data row{parsed.body.length === 1 ? '' : 's'} and{' '}
                <strong>{parsed.headers.length}</strong> columns.
              </p>
            )}
          </div>
        </Card>

        {parsed && (
          <Card title="2. Match your columns" subtitle="We guessed from the headings; adjust anything that looks wrong.">
            <div className="form-grid">
              {FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  htmlFor={`map-${field.key}`}
                  hint={field.hint || undefined}
                  optional={!field.required}
                  error={field.required && !mapping[field.key] ? 'Choose a column.' : undefined}
                >
                  <Select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? ''}
                    invalid={field.required && !mapping[field.key]}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                  >
                    <option value="">— not imported —</option>
                    {parsed.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </Card>
        )}

        {parsed && previewRows.length > 0 && (
          <Card title="3. Preview and import" subtitle={`Showing the first ${previewRows.length} of ${mappedRows.length} rows as they will be imported.`} flush>
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">Preview of mapped rows</caption>
                <thead>
                  <tr>
                    {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} scope="col">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="small">
                          {row[f.key] || <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card__footer row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <p className="small muted" style={{ margin: 0 }}>
                {missingRequired.length > 0
                  ? `Map ${missingRequired.map((f) => f.label.toLowerCase()).join(' and ')} to continue.`
                  : `Amounts are read in ${session.organization.currency}. Rows with problems are reported, never silently dropped.`}
              </p>
              <button type="button" className="btn btn--primary" disabled={!canImport} onClick={() => runImport.mutate(mappedRows)}>
                <Upload size={16} aria-hidden="true" />
                {runImport.isPending ? 'Importing…' : `Import ${mappedRows.length} row${mappedRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </Card>
        )}

        {result && (
          <Card
            title="Import results"
            subtitle={`${result.created} created · ${result.skipped} skipped · ${result.errors} with problems${result.fundersCreated ? ` · ${result.fundersCreated} funder${result.fundersCreated === 1 ? '' : 's'} added` : ''}`}
            flush
            actions={
              <Link to="/grants" className="btn btn--primary">
                Open the portfolio
              </Link>
            }
          >
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">Row by row import outcome</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Grant</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.row}>
                      <td className="small">{row.row}</td>
                      <td>{row.grantId ? <Link to={`/grants/${row.grantId}`}>{row.title}</Link> : row.title}</td>
                      <td>
                        {row.outcome === 'created' && (
                          <Badge tone="positive">
                            <CircleCheck size={13} aria-hidden="true" /> Created
                          </Badge>
                        )}
                        {row.outcome === 'skipped' && <Badge tone="plain">Skipped</Badge>}
                        {row.outcome === 'error' && (
                          <Badge tone="risk">
                            <CircleAlert size={13} aria-hidden="true" /> Problem
                          </Badge>
                        )}
                      </td>
                      <td className="small muted">{row.message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
