/**
 * The demo portfolio for Riverbend Community Alliance, a fictional Portland
 * nonprofit, plus a second tenant used to exercise isolation.
 *
 * All dates are expressed as day offsets from the seed date so the dashboard
 * always contains overdue, due-soon, healthy and renewal-risk examples no matter
 * when the demo is set up.
 */

import type {
  DocumentType,
  FunderType,
  GrantStatus,
  MilestoneStatus,
  MilestoneType,
  TaskPriority,
  TaskStatus,
} from '../../shared/constants';

export interface FunderSpec {
  key: string;
  orgKey: string;
  name: string;
  type: FunderType;
  focusAreas: string[];
  website: string | null;
  notes: string;
  contacts: Array<{ name: string; title: string; email: string; phone: string; notes?: string }>;
}

export interface MilestoneSpec {
  key: string;
  type: MilestoneType;
  title: string;
  dueOffset: number;
  status: MilestoneStatus;
  requiredEvidenceCount: number;
  notes?: string;
}

export interface TaskSpec {
  key: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOffset: number | null;
  assigneeKey: string | null;
}

export interface BudgetSpec {
  category: string;
  description: string;
  planned: string;
  spent: string;
}

export interface EvidenceSpec {
  name: string;
  docType: DocumentType;
  milestoneKey: string | null;
  uploaderKey: string;
  daysAgo: number;
  summary: string[];
}

export interface CommentSpec {
  authorKey: string;
  body: string;
  daysAgo: number;
}

export interface GrantSpec {
  key: string;
  orgKey: string;
  funderKey: string;
  ownerKey: string | null;
  title: string;
  program: string;
  status: GrantStatus;
  requested: string;
  awarded: string;
  probability: number | null;
  purpose: string;
  requirements: string;
  nextAction: string;
  notes?: string;
  applicationOffset: number | null;
  decisionOffset: number | null;
  startOffset: number | null;
  endOffset: number | null;
  renewalOffset: number | null;
  closeoutOffset: number | null;
  budget: BudgetSpec[];
  milestones: MilestoneSpec[];
  tasks: TaskSpec[];
  evidence: EvidenceSpec[];
  comments: CommentSpec[];
}

export const DEMO_ORGS = [
  {
    key: 'riverbend',
    name: 'Riverbend Community Alliance',
    slug: 'riverbend',
    timezone: 'America/Los_Angeles',
    currency: 'USD',
    fiscalYearStartMonth: 7,
  },
  {
    key: 'cascade',
    name: 'Cascade Youth Collective',
    slug: 'cascade-youth',
    timezone: 'America/Los_Angeles',
    currency: 'USD',
    fiscalYearStartMonth: 1,
  },
] as const;

export const DEMO_FUNDERS: FunderSpec[] = [
  {
    key: 'alder',
    orgKey: 'riverbend',
    name: 'Alder Point Foundation',
    type: 'PRIVATE_FOUNDATION',
    focusAreas: ['Housing stability', 'Economic mobility'],
    website: 'https://alderpoint.example.org',
    notes:
      'Two-year general operating and program grants. Requires a narrative and financial report at the midpoint and close of each year. Program officer prefers a call before renewal.',
    contacts: [
      {
        name: 'Helen Marchetti',
        title: 'Senior Program Officer',
        email: 'hmarchetti@alderpoint.example.org',
        phone: '(503) 555-0142',
        notes: 'Primary contact for both active awards. Prefers email; responds within two business days.',
      },
      {
        name: 'Devon Park',
        title: 'Grants Manager',
        email: 'dpark@alderpoint.example.org',
        phone: '(503) 555-0148',
        notes: 'Handles report portal access and payment scheduling.',
      },
    ],
  },
  {
    key: 'cascadia',
    orgKey: 'riverbend',
    name: 'Cascadia Health Trust',
    type: 'PRIVATE_FOUNDATION',
    focusAreas: ['Behavioral health', 'Health equity'],
    website: 'https://cascadiahealthtrust.example.org',
    notes:
      'Health conversion foundation. Quarterly financial reporting on a fixed template; narrative reporting twice a year. Site visit in year two of any multi-year award.',
    contacts: [
      {
        name: 'Dr. Aisha Bennett',
        title: 'Director of Programs',
        email: 'abennett@cascadiahealthtrust.example.org',
        phone: '(503) 555-0177',
      },
      {
        name: 'Ray Kowalczyk',
        title: 'Compliance Analyst',
        email: 'rkowalczyk@cascadiahealthtrust.example.org',
        phone: '(503) 555-0179',
        notes: 'Reviews financial templates. Rejects reports that do not reconcile to the approved budget lines.',
      },
    ],
  },
  {
    key: 'portland',
    orgKey: 'riverbend',
    name: 'City of Portland — Office of Community & Civic Life',
    type: 'LOCAL',
    focusAreas: ['Neighborhood safety', 'Civic engagement'],
    website: 'https://portland.example.gov/civic-life',
    notes:
      'Municipal contract-style grant. Monthly invoicing with receipts, plus a closeout report within 30 days of the period end. Unspent funds must be returned.',
    contacts: [
      {
        name: 'Sofia Nakamura',
        title: 'Contract Administrator',
        email: 'sofia.nakamura@portland.example.gov',
        phone: '(503) 555-0113',
      },
    ],
  },
  {
    key: 'meyerson',
    orgKey: 'riverbend',
    name: 'Meyerson Family Fund',
    type: 'FAMILY_FOUNDATION',
    focusAreas: ['Early childhood', 'Family literacy'],
    website: 'https://meyersonfamilyfund.example.org',
    notes:
      'Small family foundation advised by a community foundation. Light reporting: a two-page letter and a simple expenditure summary. Board meets in March and September.',
    contacts: [
      {
        name: 'Judith Meyerson',
        title: 'Trustee',
        email: 'jmeyerson@meyersonfamilyfund.example.org',
        phone: '(971) 555-0122',
        notes: 'Family trustee. Appreciates a short story about a specific family in every report.',
      },
    ],
  },
  {
    key: 'nwhousing',
    orgKey: 'riverbend',
    name: 'Northwest Housing Partnership',
    type: 'INTERMEDIARY',
    focusAreas: ['Homelessness prevention', 'Rental assistance'],
    website: 'https://nwhousingpartnership.example.org',
    notes:
      'Re-granter passing through state and federal housing dollars. Subrecipient monitoring applies: expect a desk review of receipts and a single-audit questionnaire each year.',
    contacts: [
      {
        name: 'Curtis Boyle',
        title: 'Subrecipient Monitor',
        email: 'cboyle@nwhousingpartnership.example.org',
        phone: '(503) 555-0190',
      },
      {
        name: 'Ingrid Sandoval',
        title: 'Program Director',
        email: 'isandoval@nwhousingpartnership.example.org',
        phone: '(503) 555-0191',
      },
    ],
  },
  {
    key: 'pacificgrove',
    orgKey: 'riverbend',
    name: 'Pacific Grove Bancorp Foundation',
    type: 'CORPORATE',
    focusAreas: ['Workforce development', 'Financial capability'],
    website: 'https://pacificgrovebancorp.example.com/foundation',
    notes:
      'Corporate giving program tied to CRA reporting. Wants participant demographics and job-placement outcomes. Employee volunteer day expected once per grant year.',
    contacts: [
      {
        name: 'Yolanda Pierce',
        title: 'Community Affairs Manager',
        email: 'ypierce@pacificgrovebancorp.example.com',
        phone: '(971) 555-0166',
      },
    ],
  },
  {
    key: 'odhs',
    orgKey: 'riverbend',
    name: 'Oregon Department of Human Services',
    type: 'STATE',
    focusAreas: ['Food security', 'Family services'],
    website: 'https://oregon.example.gov/dhs',
    notes:
      'State contract with cost-reimbursement billing. Requires monthly expenditure reports, quarterly performance data, and retention of source documents for six years.',
    contacts: [
      {
        name: 'Brenda Alcaraz',
        title: 'Contract Analyst',
        email: 'brenda.alcaraz@oregon.example.gov',
        phone: '(503) 555-0155',
        notes: 'Strict on the 15th-of-month expenditure deadline. Late reports delay reimbursement by a full cycle.',
      },
    ],
  },
  {
    key: 'unitedway',
    orgKey: 'riverbend',
    name: 'United Way of the Willamette Valley',
    type: 'INTERMEDIARY',
    focusAreas: ['Senior services', 'Basic needs'],
    website: 'https://uwwillamette.example.org',
    notes:
      'Community impact grant on a two-year cycle. Uses a shared outcomes framework; data is submitted through their portal every six months.',
    contacts: [
      {
        name: 'Terrance Whitlow',
        title: 'Community Impact Officer',
        email: 'twhitlow@uwwillamette.example.org',
        phone: '(541) 555-0134',
      },
    ],
  },
  {
    key: 'harborview',
    orgKey: 'riverbend',
    name: 'Harborview Community Foundation',
    type: 'COMMUNITY_FOUNDATION',
    focusAreas: ['Digital access', 'Arts & culture'],
    website: 'https://harborviewcf.example.org',
    notes:
      'Community foundation managing several donor-advised funds. Application windows in February and August. Reporting is a single form at the end of the grant period.',
    contacts: [
      {
        name: 'Miriam Oyelowo',
        title: 'Program Associate',
        email: 'moyelowo@harborviewcf.example.org',
        phone: '(503) 555-0128',
      },
    ],
  },
  {
    key: 'cascade-tri',
    orgKey: 'cascade',
    name: 'Tri-County Youth Fund',
    type: 'COMMUNITY_FOUNDATION',
    focusAreas: ['Youth development', 'Mentoring'],
    website: 'https://tricountyyouth.example.org',
    notes: 'Regional youth funder. Annual renewal with a short outcomes report.',
    contacts: [
      { name: 'Paulette Rusk', title: 'Program Director', email: 'prusk@tricountyyouth.example.org', phone: '(503) 555-0180' },
    ],
  },
  {
    key: 'cascade-summit',
    orgKey: 'cascade',
    name: 'Summit Athletic Trust',
    type: 'PRIVATE_FOUNDATION',
    focusAreas: ['Youth sports', 'Nutrition'],
    website: null,
    notes: 'Supports equipment and coaching stipends. No formal reporting template.',
    contacts: [
      { name: 'Gordon Hale', title: 'Trustee', email: 'ghale@summitathletic.example.org', phone: '(503) 555-0186' },
    ],
  },
];

export const DEMO_GRANTS: GrantSpec[] = [
  /* ---------------------------------------------------- 1. evidence gap risk */
  {
    key: 'family-stability',
    orgKey: 'riverbend',
    funderKey: 'alder',
    ownerKey: 'priya',
    title: 'Family Stability Navigators',
    program: 'Housing & Economic Mobility',
    status: 'REPORTING',
    requested: '300000',
    awarded: '285000',
    probability: null,
    purpose:
      'Four bilingual navigators help 220 households facing eviction hold onto their housing through emergency rent assistance, landlord mediation, and benefits enrollment.',
    requirements:
      'Semi-annual narrative report and financial report on the funder template.\nQuarterly household-level outcome data (households served, evictions prevented, average assistance).\nAcknowledgement of Alder Point in all program materials.\nNotify the program officer within 30 days of any budget line changing by more than 10%.',
    nextAction: 'Collect the Q2 outcome export and signed landlord mediation log before the mid-year report.',
    applicationOffset: -300,
    decisionOffset: -268,
    startOffset: -260,
    endOffset: 105,
    renewalOffset: 95,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '4.0 FTE navigators + 0.25 FTE supervisor', planned: '168000', spent: '119400' },
      { category: 'Benefits & payroll taxes', description: 'Calculated at 24.5% of salaries', planned: '41160', spent: '29253' },
      { category: 'Direct client assistance', description: 'Emergency rent and utility payments', planned: '48000', spent: '35600' },
      { category: 'Interpretation & translation', description: 'Spanish, Vietnamese, Russian', planned: '9200', spent: '5975' },
      { category: 'Travel & mileage', description: 'Home visits and court accompaniment', planned: '4640', spent: '3010' },
      { category: 'Indirect (10%)', description: 'Negotiated de minimis rate', planned: '14000', spent: '9910' },
    ],
    milestones: [
      { key: 'app', type: 'APPLICATION', title: 'Full proposal submitted', dueOffset: -300, status: 'COMPLETE', requiredEvidenceCount: 0 },
      { key: 'agreement', type: 'OTHER', title: 'Countersigned grant agreement on file', dueOffset: -258, status: 'COMPLETE', requiredEvidenceCount: 1 },
      {
        key: 'midyear',
        type: 'REPORT',
        title: 'Mid-year narrative report',
        dueOffset: 9,
        status: 'IN_PROGRESS',
        requiredEvidenceCount: 4,
        notes: 'Needs the Q2 outcomes export, mediation log, two participant stories, and the updated logic model.',
      },
      {
        key: 'midyear-fin',
        type: 'FINANCIAL_REPORT',
        title: 'Mid-year financial report',
        dueOffset: 9,
        status: 'NOT_STARTED',
        requiredEvidenceCount: 2,
        notes: 'Funder template plus a general-ledger extract reconciled to the approved budget lines.',
      },
      { key: 'payment2', type: 'PAYMENT', title: 'Second payment released ($142,500)', dueOffset: 24, status: 'NOT_STARTED', requiredEvidenceCount: 0 },
      { key: 'renewal', type: 'RENEWAL', title: 'Renewal conversation with program officer', dueOffset: 88, status: 'NOT_STARTED', requiredEvidenceCount: 0 },
    ],
    tasks: [
      { key: 't1', title: 'Pull Q2 outcome data from the case management system', status: 'IN_PROGRESS', priority: 'URGENT', dueOffset: 2, assigneeKey: 'priya', description: 'Households served, evictions prevented, average assistance per household, and demographics.' },
      { key: 't2', title: 'Reconcile personnel allocations with the payroll register', status: 'TODO', priority: 'HIGH', dueOffset: 4, assigneeKey: 'naomi' },
      { key: 't3', title: 'Draft two participant stories with consent forms', status: 'TODO', priority: 'MEDIUM', dueOffset: 5, assigneeKey: 'priya' },
      { key: 't4', title: 'Schedule renewal call with Helen Marchetti', status: 'TODO', priority: 'MEDIUM', dueOffset: 40, assigneeKey: 'marcus' },
      { key: 't5', title: 'File the countersigned agreement in the evidence library', status: 'DONE', priority: 'LOW', dueOffset: -250, assigneeKey: 'priya' },
    ],
    evidence: [
      {
        name: 'Alder-Point-Grant-Agreement-Countersigned.pdf',
        docType: 'AGREEMENT',
        milestoneKey: 'agreement',
        uploaderKey: 'priya',
        daysAgo: 250,
        summary: ['Grant agreement between Alder Point Foundation and Riverbend Community Alliance.', 'Award: $285,000 over 12 months.', 'Countersigned by both parties.'],
      },
      {
        name: 'Q2-Household-Outcomes-Draft.xlsx',
        docType: 'DATA_EXPORT',
        milestoneKey: 'midyear',
        uploaderKey: 'priya',
        daysAgo: 6,
        summary: ['Draft export of Q2 household outcomes pending final QA.'],
      },
      {
        name: 'Landlord-Mediation-Log-Q2.pdf',
        docType: 'NARRATIVE',
        milestoneKey: 'midyear',
        uploaderKey: 'priya',
        daysAgo: 3,
        summary: ['Log of 64 landlord mediations conducted in Q2.', 'Includes outcome codes and follow-up dates.'],
      },
    ],
    comments: [
      { authorKey: 'marcus', body: 'Helen confirmed the mid-year report can be submitted through the portal rather than by email this cycle. Same deadline.', daysAgo: 12 },
      { authorKey: 'priya', body: 'Still waiting on consent forms for the two participant stories. If they are not back by Friday I will swap in the anonymised case summary we used last year.', daysAgo: 3 },
      { authorKey: 'naomi', body: 'Payroll register is reconciled through the end of last month. The 10% indirect line is tracking slightly under, which gives us a little room if interpretation costs run over.', daysAgo: 2 },
    ],
  },

  /* --------------------------------------------------- 2. overdue milestone */
  {
    key: 'food-hub',
    orgKey: 'riverbend',
    funderKey: 'odhs',
    ownerKey: 'marcus',
    title: 'Community Food Hub Expansion',
    program: 'Food Security',
    status: 'REPORTING',
    requested: '410000',
    awarded: '410000',
    probability: null,
    purpose:
      'Expands the Riverbend food hub with refrigerated storage and a second distribution site, raising weekly capacity from 900 to 1,600 households.',
    requirements:
      'Monthly expenditure report due by the 15th of the following month.\nQuarterly performance report with households served and pounds distributed.\nRetain all source documents for six years.\nPrior written approval required for equipment purchases over $5,000.',
    nextAction: 'Submit the overdue monthly expenditure report — reimbursement is on hold until it clears.',
    applicationOffset: -240,
    decisionOffset: -205,
    startOffset: -190,
    endOffset: 175,
    renewalOffset: 160,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: 'Hub coordinator, 2 drivers, warehouse lead', planned: '186000', spent: '92600' },
      { category: 'Benefits & payroll taxes', description: '26% of salaries', planned: '48360', spent: '24076' },
      { category: 'Equipment', description: 'Walk-in cooler and pallet jack (pre-approved)', planned: '74000', spent: '71850' },
      { category: 'Food purchase', description: 'Culturally specific staples not covered by donations', planned: '52000', spent: '25400' },
      { category: 'Vehicle & fuel', description: 'Refrigerated van lease and fuel', planned: '28800', spent: '14200' },
      { category: 'Facility', description: 'Second site rent and utilities', planned: '20840', spent: '10120' },
    ],
    milestones: [
      { key: 'app', type: 'APPLICATION', title: 'State contract application', dueOffset: -240, status: 'COMPLETE', requiredEvidenceCount: 0 },
      {
        key: 'exp-late',
        type: 'FINANCIAL_REPORT',
        title: 'Monthly expenditure report — prior month',
        dueOffset: -12,
        status: 'IN_PROGRESS',
        requiredEvidenceCount: 2,
        notes: 'Blocked on the equipment invoice reconciliation. Reimbursement is held until this is accepted.',
      },
      { key: 'perf-q', type: 'REPORT', title: 'Quarterly performance report', dueOffset: 21, status: 'NOT_STARTED', requiredEvidenceCount: 3 },
      { key: 'visit', type: 'SITE_VISIT', title: 'Contract analyst site visit', dueOffset: 58, status: 'NOT_STARTED', requiredEvidenceCount: 0 },
      { key: 'exp-next', type: 'FINANCIAL_REPORT', title: 'Monthly expenditure report — current month', dueOffset: 18, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
    ],
    tasks: [
      { key: 't1', title: 'Reconcile walk-in cooler invoice against the pre-approval letter', status: 'IN_PROGRESS', priority: 'URGENT', dueOffset: -8, assigneeKey: 'naomi', description: 'The vendor split the invoice across two POs, which broke the expenditure report import.' },
      { key: 't2', title: 'Resubmit the expenditure report through the state portal', status: 'BLOCKED', priority: 'URGENT', dueOffset: -3, assigneeKey: 'marcus' },
      { key: 't3', title: 'Pull pounds-distributed data for the quarterly report', status: 'TODO', priority: 'HIGH', dueOffset: 14, assigneeKey: 'priya' },
      { key: 't4', title: 'Prepare site visit binder and safety documentation', status: 'TODO', priority: 'MEDIUM', dueOffset: 50, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Walk-In-Cooler-Invoice-Partial.pdf',
        docType: 'RECEIPT',
        milestoneKey: 'exp-late',
        uploaderKey: 'naomi',
        daysAgo: 15,
        summary: ['Vendor invoice for refrigeration equipment.', 'Note: split across two purchase orders.'],
      },
      {
        name: 'Equipment-Preapproval-Letter-ODHS.pdf',
        docType: 'CORRESPONDENCE',
        milestoneKey: null,
        uploaderKey: 'marcus',
        daysAgo: 120,
        summary: ['State approval for equipment purchases exceeding $5,000.', 'Covers walk-in cooler and pallet jack.'],
      },
    ],
    comments: [
      { authorKey: 'naomi', body: 'The vendor split the cooler invoice across two POs. I have asked for a consolidated invoice; if it does not arrive tomorrow I will file both with a reconciliation memo.', daysAgo: 9 },
      { authorKey: 'marcus', body: 'Brenda flagged that reimbursement for the whole quarter is on hold until this report clears. This is our top priority this week.', daysAgo: 7 },
    ],
  },

  /* --------------------------------------------------------- 3. on track */
  {
    key: 'workforce-bridge',
    orgKey: 'riverbend',
    funderKey: 'pacificgrove',
    ownerKey: 'priya',
    title: 'Youth Workforce Bridge',
    program: 'Workforce Development',
    status: 'AWARDED',
    requested: '120000',
    awarded: '120000',
    probability: null,
    purpose:
      'A 14-week paid pre-apprenticeship for 48 young adults aged 18–24, combining construction-trades basics, financial coaching, and placement support with three employer partners.',
    requirements:
      'Participant demographics and job-placement outcomes at the close of each cohort.\nOne employee volunteer day hosted per grant year.\nLogo placement on cohort materials.',
    nextAction: 'Confirm employer placement commitments for the spring cohort.',
    applicationOffset: -95,
    decisionOffset: -58,
    startOffset: -45,
    endOffset: 320,
    renewalOffset: 300,
    closeoutOffset: null,
    budget: [
      { category: 'Participant stipends', description: '48 participants × $1,050', planned: '50400', spent: '8400' },
      { category: 'Personnel', description: '0.75 FTE instructor, 0.4 FTE placement specialist', planned: '43200', spent: '7100' },
      { category: 'Tools & safety gear', description: 'Boots, hard hats, hand tools per participant', planned: '12000', spent: '2450' },
      { category: 'Credential testing fees', description: 'OSHA-10 and first aid certification', planned: '6000', spent: '900' },
      { category: 'Transit passes', description: 'Monthly passes during the cohort', planned: '8400', spent: '1200' },
    ],
    milestones: [
      { key: 'agreement', type: 'OTHER', title: 'Grant agreement executed', dueOffset: -50, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'cohort1', type: 'REPORT', title: 'Cohort 1 outcomes report', dueOffset: 86, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
      { key: 'volunteer', type: 'OTHER', title: 'Host Pacific Grove employee volunteer day', dueOffset: 132, status: 'NOT_STARTED', requiredEvidenceCount: 0 },
      { key: 'final', type: 'REPORT', title: 'Final report and placement summary', dueOffset: 310, status: 'NOT_STARTED', requiredEvidenceCount: 3 },
    ],
    tasks: [
      { key: 't1', title: 'Confirm spring cohort employer placements', status: 'IN_PROGRESS', priority: 'HIGH', dueOffset: 21, assigneeKey: 'priya' },
      { key: 't2', title: 'Order safety gear for cohort 2', status: 'TODO', priority: 'MEDIUM', dueOffset: 46, assigneeKey: 'priya' },
      { key: 't3', title: 'Schedule OSHA-10 proctor', status: 'TODO', priority: 'LOW', dueOffset: 63, assigneeKey: 'marcus' },
      { key: 't4', title: 'Set up participant demographic tracking fields', status: 'DONE', priority: 'MEDIUM', dueOffset: -30, assigneeKey: 'priya' },
    ],
    evidence: [
      {
        name: 'Pacific-Grove-Grant-Agreement.pdf',
        docType: 'AGREEMENT',
        milestoneKey: 'agreement',
        uploaderKey: 'priya',
        daysAgo: 48,
        summary: ['Corporate foundation grant agreement.', 'Award: $120,000 for 12 months.'],
      },
    ],
    comments: [
      { authorKey: 'priya', body: 'Two of the three employer partners have signed placement commitments. The third wants to see cohort 1 completion rates first, which is reasonable.', daysAgo: 8 },
    ],
  },

  /* ------------------------------------------- 4. renewal + closeout pressure */
  {
    key: 'peer-support',
    orgKey: 'riverbend',
    funderKey: 'cascadia',
    ownerKey: 'marcus',
    title: 'Behavioral Health Peer Support',
    program: 'Behavioral Health',
    status: 'RENEWAL',
    requested: '340000',
    awarded: '325000',
    probability: null,
    purpose:
      'Twelve certified peer support specialists provide non-clinical recovery support in three clinics and the county jail re-entry program, reaching roughly 640 people a year.',
    requirements:
      'Quarterly financial reporting on the Cascadia template.\nSemi-annual narrative reporting.\nSite visit required in year two.\nRenewal application due 60 days before the period ends.',
    nextAction: 'Submit the renewal application — the window closes before the current period ends.',
    applicationOffset: -380,
    decisionOffset: -334,
    startOffset: -320,
    endOffset: 45,
    renewalOffset: 30,
    closeoutOffset: 75,
    budget: [
      { category: 'Personnel', description: '12 peer specialists at 0.8 FTE average', planned: '208000', spent: '182400' },
      { category: 'Benefits & payroll taxes', description: '25% of salaries', planned: '52000', spent: '45600' },
      { category: 'Certification & training', description: 'THW certification renewals and supervision', planned: '18000', spent: '15200' },
      { category: 'Clinical supervision', description: 'Contracted supervision hours', planned: '24000', spent: '20000' },
      { category: 'Program supplies', description: 'Recovery materials and participant incentives', planned: '11000', spent: '8600' },
      { category: 'Indirect (4%)', description: 'Funder-capped indirect rate', planned: '12000', spent: '10400' },
    ],
    milestones: [
      { key: 'q3fin', type: 'FINANCIAL_REPORT', title: 'Q3 financial report', dueOffset: -46, status: 'COMPLETE', requiredEvidenceCount: 2 },
      { key: 'narrative2', type: 'REPORT', title: 'Second semi-annual narrative report', dueOffset: 12, status: 'IN_PROGRESS', requiredEvidenceCount: 3 },
      { key: 'q4fin', type: 'FINANCIAL_REPORT', title: 'Q4 financial report', dueOffset: 40, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
      { key: 'renewal', type: 'RENEWAL', title: 'Renewal application (Year 3)', dueOffset: 22, status: 'IN_PROGRESS', requiredEvidenceCount: 2 },
      { key: 'closeout', type: 'REPORT', title: 'Closeout report', dueOffset: 75, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
    ],
    tasks: [
      { key: 't1', title: 'Draft renewal narrative with updated outcomes', status: 'IN_PROGRESS', priority: 'URGENT', dueOffset: 8, assigneeKey: 'marcus' },
      { key: 't2', title: 'Build Year 3 budget with the 4% indirect cap', status: 'TODO', priority: 'HIGH', dueOffset: 12, assigneeKey: 'naomi' },
      { key: 't3', title: 'Collect peer specialist certification renewals', status: 'TODO', priority: 'MEDIUM', dueOffset: 26, assigneeKey: 'priya' },
      { key: 't4', title: 'Confirm clinic partner letters of support', status: 'TODO', priority: 'HIGH', dueOffset: 15, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Q3-Financial-Report-Cascadia.xlsx',
        docType: 'FINANCIAL',
        milestoneKey: 'q3fin',
        uploaderKey: 'naomi',
        daysAgo: 50,
        summary: ['Quarterly financial report on the Cascadia Health Trust template.', 'Reconciled to approved budget lines.'],
      },
      {
        name: 'Q3-General-Ledger-Extract.xlsx',
        docType: 'FINANCIAL',
        milestoneKey: 'q3fin',
        uploaderKey: 'naomi',
        daysAgo: 50,
        summary: ['General ledger extract supporting the Q3 financial report.'],
      },
      {
        name: 'Peer-Support-Outcomes-Year2.pdf',
        docType: 'DATA_EXPORT',
        milestoneKey: 'renewal',
        uploaderKey: 'marcus',
        daysAgo: 11,
        summary: ['Year 2 outcomes: 638 people served, 71% engagement retention at 90 days.'],
      },
    ],
    comments: [
      { authorKey: 'marcus', body: 'Dr. Bennett signalled informally that a Year 3 renewal is likely but not guaranteed, and that they want to see the jail re-entry numbers broken out separately.', daysAgo: 16 },
      { authorKey: 'dana', body: 'This is 11% of our operating revenue. If the renewal slips we need a bridge plan by the board meeting.', daysAgo: 5 },
    ],
  },

  /* ------------------------------------------------------- 5. burn ahead */
  {
    key: 'housing-retention',
    orgKey: 'riverbend',
    funderKey: 'nwhousing',
    ownerKey: 'naomi',
    title: 'Housing Retention Fund',
    program: 'Homelessness Prevention',
    status: 'REPORTING',
    requested: '250000',
    awarded: '250000',
    probability: null,
    purpose:
      'Flexible retention assistance — back rent, deposits, and one-time arrears — for households at imminent risk of losing housing, paired with light-touch case management.',
    requirements:
      'Subrecipient monitoring: annual desk review of receipts.\nSingle-audit questionnaire each fiscal year.\nHousehold-level data submitted monthly through the partner portal.\nAssistance capped at $3,500 per household without written approval.',
    nextAction: 'Review the spend rate with the program director — assistance is outpacing the schedule.',
    applicationOffset: -205,
    decisionOffset: -165,
    startOffset: -150,
    endOffset: 215,
    renewalOffset: 200,
    closeoutOffset: null,
    budget: [
      { category: 'Direct client assistance', description: 'Back rent, deposits, arrears', planned: '180000', spent: '147800' },
      { category: 'Personnel', description: '1.5 FTE housing case managers', planned: '48000', spent: '19200' },
      { category: 'Benefits & payroll taxes', description: '24% of salaries', planned: '11520', spent: '4608' },
      { category: 'Data & portal fees', description: 'HMIS licence and portal access', planned: '4800', spent: '2100' },
      { category: 'Indirect (2.3%)', description: 'Pass-through capped rate', planned: '5680', spent: '3400' },
    ],
    milestones: [
      { key: 'desk', type: 'OTHER', title: 'Subrecipient desk review', dueOffset: -30, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'monthly', type: 'FINANCIAL_REPORT', title: 'Monthly household data submission', dueOffset: 11, status: 'NOT_STARTED', requiredEvidenceCount: 1 },
      { key: 'midterm', type: 'REPORT', title: 'Mid-term progress report', dueOffset: 34, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
      { key: 'audit', type: 'OTHER', title: 'Single-audit questionnaire', dueOffset: 96, status: 'NOT_STARTED', requiredEvidenceCount: 1 },
    ],
    tasks: [
      { key: 't1', title: 'Model remaining assistance capacity at the current burn rate', status: 'IN_PROGRESS', priority: 'URGENT', dueOffset: -5, assigneeKey: 'naomi', description: 'At the current pace the assistance line is exhausted roughly nine weeks before the period ends.' },
      { key: 't2', title: 'Draft a request to shift personnel savings into direct assistance', status: 'TODO', priority: 'HIGH', dueOffset: -1, assigneeKey: 'naomi' },
      { key: 't3', title: 'Brief Ingrid Sandoval on the projected shortfall', status: 'TODO', priority: 'HIGH', dueOffset: 6, assigneeKey: 'marcus' },
      { key: 't4', title: 'Audit ten assistance files for the $3,500 cap', status: 'TODO', priority: 'MEDIUM', dueOffset: 20, assigneeKey: 'priya' },
    ],
    evidence: [
      {
        name: 'Subrecipient-Desk-Review-Findings.pdf',
        docType: 'CORRESPONDENCE',
        milestoneKey: 'desk',
        uploaderKey: 'naomi',
        daysAgo: 28,
        summary: ['Desk review completed with no findings.', 'Recommendation: tighten documentation on landlord W-9 collection.'],
      },
    ],
    comments: [
      { authorKey: 'naomi', body: 'We are at 82% of the assistance line with 41% of the period elapsed. Demand spiked after the county rental programme closed. We need either a budget modification or a slower approval cadence.', daysAgo: 4 },
      { authorKey: 'dana', body: 'Do not slow approvals without talking to me first. Let us ask for the modification and be transparent about why demand moved.', daysAgo: 3 },
    ],
  },

  /* ------------------------------------------------------ 6. burn behind */
  {
    key: 'early-literacy',
    orgKey: 'riverbend',
    funderKey: 'meyerson',
    ownerKey: 'priya',
    title: 'Early Literacy Home Visits',
    program: 'Early Childhood',
    status: 'AWARDED',
    requested: '75000',
    awarded: '75000',
    probability: null,
    purpose:
      'Twice-monthly home visits for 60 families with children under five, delivering shared reading coaching and a growing home library in the family’s first language.',
    requirements:
      'Two-page narrative letter and a simple expenditure summary at the end of the grant year.\nInclude at least one family story.\nNo prior approval needed for line-item shifts under 15%.',
    nextAction: 'Hire the second home visitor — the position has been open for two months.',
    applicationOffset: -140,
    decisionOffset: -102,
    startOffset: -90,
    endOffset: 275,
    renewalOffset: 250,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '1.0 FTE home visitor (2nd position unfilled)', planned: '46000', spent: '2300' },
      { category: 'Benefits & payroll taxes', description: '24% of salaries', planned: '11040', spent: '552' },
      { category: 'Books & materials', description: 'Home library sets in 4 languages', planned: '9600', spent: '900' },
      { category: 'Mileage', description: 'Home visit travel', planned: '3360', spent: '190' },
      { category: 'Training', description: 'Reading coaching certification', planned: '5000', spent: '0' },
    ],
    milestones: [
      { key: 'letter', type: 'REPORT', title: 'Year-end narrative letter', dueOffset: 268, status: 'NOT_STARTED', requiredEvidenceCount: 1 },
      { key: 'expenditure', type: 'FINANCIAL_REPORT', title: 'Expenditure summary', dueOffset: 268, status: 'NOT_STARTED', requiredEvidenceCount: 1 },
    ],
    tasks: [
      { key: 't1', title: 'Repost the home visitor role with a higher wage band', status: 'IN_PROGRESS', priority: 'HIGH', dueOffset: 9, assigneeKey: 'priya' },
      { key: 't2', title: 'Order home library sets for the first 20 families', status: 'TODO', priority: 'MEDIUM', dueOffset: 30, assigneeKey: 'priya' },
      { key: 't3', title: 'Schedule reading coaching certification', status: 'TODO', priority: 'LOW', dueOffset: 55, assigneeKey: 'priya' },
    ],
    evidence: [],
    comments: [
      { authorKey: 'priya', body: 'The second home visitor role has been open for two months. Judith knows and is relaxed about it, but we should flag the underspend in the year-end letter rather than let her find it.', daysAgo: 6 },
    ],
  },

  /* -------------------------------------------------- 7. closeout pressure */
  {
    key: 'safety-corps',
    orgKey: 'riverbend',
    funderKey: 'portland',
    ownerKey: 'marcus',
    title: 'Neighborhood Safety Corps',
    program: 'Community Safety',
    status: 'CLOSEOUT',
    requested: '95000',
    awarded: '95000',
    probability: null,
    purpose:
      'Eight community safety ambassadors provide de-escalation, wayfinding and business liaison work across two commercial corridors.',
    requirements:
      'Monthly invoicing with itemised receipts.\nCloseout report within 30 days of the period end.\nUnspent funds must be returned to the City.',
    nextAction: 'Close out the final two deliverables before the period ends in under three weeks.',
    applicationOffset: -395,
    decisionOffset: -362,
    startOffset: -350,
    endOffset: 20,
    renewalOffset: null,
    closeoutOffset: 50,
    budget: [
      { category: 'Personnel', description: '8 ambassadors, part-time', planned: '62000', spent: '58900' },
      { category: 'Benefits & payroll taxes', description: '22% of wages', planned: '13640', spent: '12958' },
      { category: 'Uniforms & radios', description: 'Branded gear and communication equipment', planned: '7200', spent: '7010' },
      { category: 'Training', description: 'De-escalation and first aid', planned: '6400', spent: '6400' },
      { category: 'Supplies', description: 'Wayfinding materials and first aid kits', planned: '5760', spent: '4120' },
    ],
    milestones: [
      { key: 'inv11', type: 'FINANCIAL_REPORT', title: 'Month 11 invoice with receipts', dueOffset: -4, status: 'SUBMITTED', requiredEvidenceCount: 2 },
      { key: 'inv12', type: 'FINANCIAL_REPORT', title: 'Final invoice with receipts', dueOffset: 26, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
      { key: 'closeout', type: 'REPORT', title: 'Closeout report', dueOffset: 50, status: 'NOT_STARTED', requiredEvidenceCount: 3 },
    ],
    tasks: [
      { key: 't1', title: 'Collect final month receipts from corridor leads', status: 'IN_PROGRESS', priority: 'HIGH', dueOffset: 12, assigneeKey: 'marcus' },
      { key: 't2', title: 'Calculate unspent balance for return to the City', status: 'TODO', priority: 'HIGH', dueOffset: 24, assigneeKey: 'naomi' },
      { key: 't3', title: 'Write the corridor outcomes narrative', status: 'TODO', priority: 'MEDIUM', dueOffset: 40, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Month-11-Invoice-Portland.pdf',
        docType: 'FINANCIAL',
        milestoneKey: 'inv11',
        uploaderKey: 'naomi',
        daysAgo: 5,
        summary: ['Monthly invoice submitted to the City of Portland.', 'Includes itemised ambassador hours and supply receipts.'],
      },
      {
        name: 'Month-11-Receipts.pdf',
        docType: 'RECEIPT',
        milestoneKey: 'inv11',
        uploaderKey: 'naomi',
        daysAgo: 5,
        summary: ['Receipt packet supporting the month 11 invoice.'],
      },
    ],
    comments: [
      { authorKey: 'naomi', body: 'We are tracking roughly $2,700 under on supplies. That has to go back to the City, so let us not scramble to spend it — just document it cleanly.', daysAgo: 10 },
    ],
  },

  /* --------------------------------------------------------- 8. no owner */
  {
    key: 'digital-access',
    orgKey: 'riverbend',
    funderKey: 'harborview',
    ownerKey: null,
    title: 'Digital Access Lab',
    program: 'Digital Equity',
    status: 'AWARDED',
    requested: '60000',
    awarded: '60000',
    probability: null,
    purpose:
      'A drop-in lab with 14 workstations, device lending, and one-to-one digital navigation for older adults and job seekers.',
    requirements: 'Single end-of-period report form.\nAcknowledge the donor-advised fund by name in public materials.',
    nextAction: 'Assign an internal owner — nobody is accountable for this award yet.',
    applicationOffset: -75,
    decisionOffset: -32,
    startOffset: -20,
    endOffset: 345,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Equipment', description: '14 refurbished workstations and lending devices', planned: '26000', spent: '0' },
      { category: 'Personnel', description: '0.5 FTE digital navigator', planned: '24000', spent: '1800' },
      { category: 'Connectivity', description: 'Business-class internet for the lab', planned: '6000', spent: '480' },
      { category: 'Supplies', description: 'Furniture and consumables', planned: '4000', spent: '0' },
    ],
    milestones: [
      { key: 'final', type: 'REPORT', title: 'End-of-period report form', dueOffset: 338, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
    ],
    tasks: [
      { key: 't1', title: 'Assign a program owner for the lab', status: 'TODO', priority: 'HIGH', dueOffset: 7, assigneeKey: null },
      { key: 't2', title: 'Get three quotes for refurbished workstations', status: 'TODO', priority: 'MEDIUM', dueOffset: 25, assigneeKey: null },
    ],
    evidence: [],
    comments: [
      { authorKey: 'dana', body: 'We accepted this award while the program director role was vacant. It needs an owner this week — the equipment purchase alone is a two-month lead time.', daysAgo: 4 },
    ],
  },

  /* --------------------------------------------------------- 9. on track */
  {
    key: 'senior-meals',
    orgKey: 'riverbend',
    funderKey: 'unitedway',
    ownerKey: 'priya',
    title: 'Senior Meals Delivery',
    program: 'Senior Services',
    status: 'REPORTING',
    requested: '140000',
    awarded: '140000',
    probability: null,
    purpose:
      'Home-delivered meals five days a week for 180 homebound seniors, with weekly wellness checks by the delivery drivers.',
    requirements:
      'Outcomes submitted through the shared portal every six months.\nParticipate in the community impact learning cohort.\nUse the shared outcomes framework definitions.',
    nextAction: 'Portal submission opens in six weeks; evidence is already assembled.',
    applicationOffset: -320,
    decisionOffset: -285,
    startOffset: -270,
    endOffset: 95,
    renewalOffset: 80,
    closeoutOffset: null,
    budget: [
      { category: 'Food & packaging', description: 'Meal production and containers', planned: '76000', spent: '55400' },
      { category: 'Personnel', description: '1.6 FTE drivers and kitchen support', planned: '38000', spent: '27900' },
      { category: 'Benefits & payroll taxes', description: '23% of wages', planned: '8740', spent: '6417' },
      { category: 'Vehicle & fuel', description: 'Two delivery routes', planned: '12600', spent: '9180' },
      { category: 'Volunteer support', description: 'Background checks and recognition', planned: '4660', spent: '3100' },
    ],
    milestones: [
      { key: 'portal1', type: 'REPORT', title: 'First portal outcomes submission', dueOffset: -95, status: 'COMPLETE', requiredEvidenceCount: 2 },
      { key: 'portal2', type: 'REPORT', title: 'Second portal outcomes submission', dueOffset: 45, status: 'IN_PROGRESS', requiredEvidenceCount: 2 },
      { key: 'renewal', type: 'RENEWAL', title: 'Two-year cycle renewal application', dueOffset: 66, status: 'NOT_STARTED', requiredEvidenceCount: 1 },
    ],
    tasks: [
      { key: 't1', title: 'Verify meal counts against driver route logs', status: 'DONE', priority: 'MEDIUM', dueOffset: -12, assigneeKey: 'priya' },
      { key: 't2', title: 'Enter outcomes in the United Way portal', status: 'TODO', priority: 'MEDIUM', dueOffset: 40, assigneeKey: 'priya' },
      { key: 't3', title: 'Attend the community impact learning cohort session', status: 'TODO', priority: 'LOW', dueOffset: 33, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Meal-Counts-and-Wellness-Checks.xlsx',
        docType: 'DATA_EXPORT',
        milestoneKey: 'portal2',
        uploaderKey: 'priya',
        daysAgo: 9,
        summary: ['Verified meal counts by route.', 'Wellness check completions and escalations.'],
      },
      {
        name: 'Senior-Meals-Outcomes-Narrative.pdf',
        docType: 'NARRATIVE',
        milestoneKey: 'portal2',
        uploaderKey: 'priya',
        daysAgo: 8,
        summary: ['Narrative outcomes using the shared framework definitions.'],
      },
      {
        name: 'Portal-Submission-Confirmation-Cycle1.pdf',
        docType: 'CORRESPONDENCE',
        milestoneKey: 'portal1',
        uploaderKey: 'priya',
        daysAgo: 92,
        summary: ['Confirmation receipt for the first portal submission.'],
      },
      {
        name: 'Route-Logs-Cycle1.xlsx',
        docType: 'DATA_EXPORT',
        milestoneKey: 'portal1',
        uploaderKey: 'priya',
        daysAgo: 93,
        summary: ['Driver route logs supporting cycle 1 meal counts.'],
      },
    ],
    comments: [
      { authorKey: 'priya', body: 'Everything for the second submission is assembled and verified. I would rather submit two weeks early than sit in the portal queue at the deadline.', daysAgo: 7 },
    ],
  },

  /* ------------------------------------------------------- 10. submitted */
  {
    key: 'legal-clinic',
    orgKey: 'riverbend',
    funderKey: 'alder',
    ownerKey: 'marcus',
    title: 'Newcomer Legal Clinic',
    program: 'Immigrant & Refugee Services',
    status: 'SUBMITTED',
    requested: '180000',
    awarded: '0',
    probability: 60,
    purpose:
      'A weekly legal clinic providing know-your-rights education, asylum application support, and referral navigation for recently arrived families.',
    requirements: 'If awarded: semi-annual narrative and financial reporting on the Alder Point template.',
    nextAction: 'Decision expected in about six weeks. No action needed until then.',
    applicationOffset: -25,
    decisionOffset: null,
    startOffset: null,
    endOffset: null,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '1.0 FTE staff attorney, 0.5 FTE paralegal', planned: '118000', spent: '0' },
      { category: 'Benefits & payroll taxes', description: '25% of salaries', planned: '29500', spent: '0' },
      { category: 'Interpretation', description: 'Contract interpreters, 6 languages', planned: '18000', spent: '0' },
      { category: 'Filing fees', description: 'Application and filing costs', planned: '9000', spent: '0' },
      { category: 'Indirect (10%)', description: 'De minimis rate', planned: '5500', spent: '0' },
    ],
    milestones: [
      { key: 'submitted', type: 'APPLICATION', title: 'Proposal submitted to Alder Point', dueOffset: -25, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'decision', type: 'OTHER', title: 'Board decision expected', dueOffset: 42, status: 'NOT_STARTED', requiredEvidenceCount: 0 },
    ],
    tasks: [
      { key: 't1', title: 'Send thank-you note to Helen for the site tour', status: 'DONE', priority: 'LOW', dueOffset: -18, assigneeKey: 'marcus' },
      { key: 't2', title: 'Prepare an attorney hiring plan in case of award', status: 'TODO', priority: 'MEDIUM', dueOffset: 35, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Newcomer-Legal-Clinic-Proposal.pdf',
        docType: 'NARRATIVE',
        milestoneKey: 'submitted',
        uploaderKey: 'marcus',
        daysAgo: 25,
        summary: ['Full proposal as submitted.', 'Request: $180,000 over 12 months.'],
      },
    ],
    comments: [
      { authorKey: 'marcus', body: 'Helen said the docket is heavy this cycle but that our alignment with their economic mobility priority is strong. I put us at 60%.', daysAgo: 20 },
    ],
  },

  /* --------------------------------------------- 11. application due soon */
  {
    key: 'rural-transit',
    orgKey: 'riverbend',
    funderKey: 'odhs',
    ownerKey: 'marcus',
    title: 'Rural Transit Access Pilot',
    program: 'Transportation Access',
    status: 'DRAFTING',
    requested: '240000',
    awarded: '0',
    probability: 35,
    purpose:
      'A demand-response van service connecting three rural communities to medical appointments, food access and benefits offices four days a week.',
    requirements: 'State RFA: budget narrative, letters from two county partners, and a route feasibility study are all mandatory attachments.',
    nextAction: 'Finish the budget narrative and secure the second county letter before the submission deadline.',
    applicationOffset: 11,
    decisionOffset: null,
    startOffset: null,
    endOffset: null,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '2.0 FTE drivers, 0.5 FTE dispatcher', planned: '104000', spent: '0' },
      { category: 'Benefits & payroll taxes', description: '24% of wages', planned: '24960', spent: '0' },
      { category: 'Vehicle lease', description: 'Two wheelchair-accessible vans', planned: '64000', spent: '0' },
      { category: 'Fuel & maintenance', description: 'Estimated 42,000 annual miles', planned: '28000', spent: '0' },
      { category: 'Scheduling software', description: 'Demand-response dispatch platform', planned: '12000', spent: '0' },
      { category: 'Indirect (3%)', description: 'State-capped indirect rate', planned: '7040', spent: '0' },
    ],
    milestones: [
      { key: 'loi', type: 'LOI', title: 'Letter of intent filed', dueOffset: -20, status: 'COMPLETE', requiredEvidenceCount: 0 },
      { key: 'app', type: 'APPLICATION', title: 'RFA submission', dueOffset: 11, status: 'IN_PROGRESS', requiredEvidenceCount: 3 },
    ],
    tasks: [
      { key: 't1', title: 'Complete the budget narrative', status: 'IN_PROGRESS', priority: 'URGENT', dueOffset: 5, assigneeKey: 'naomi' },
      { key: 't2', title: 'Secure the second county partner letter', status: 'TODO', priority: 'URGENT', dueOffset: 7, assigneeKey: 'marcus' },
      { key: 't3', title: 'Attach the route feasibility study', status: 'TODO', priority: 'HIGH', dueOffset: 9, assigneeKey: 'marcus' },
      { key: 't4', title: 'Internal review of the full application', status: 'TODO', priority: 'HIGH', dueOffset: 10, assigneeKey: 'dana' },
    ],
    evidence: [
      {
        name: 'Route-Feasibility-Study-Draft.pdf',
        docType: 'NARRATIVE',
        milestoneKey: 'app',
        uploaderKey: 'marcus',
        daysAgo: 14,
        summary: ['Draft feasibility study covering three rural routes.', 'Estimated 42,000 annual miles.'],
      },
    ],
    comments: [
      { authorKey: 'marcus', body: 'One county letter is in hand. The second commissioner’s office wants to see the route map before signing, so I sent the draft study over.', daysAgo: 6 },
    ],
  },

  /* -------------------------------------------------------- 12. prospect */
  {
    key: 'finance-systems',
    orgKey: 'riverbend',
    funderKey: 'meyerson',
    ownerKey: 'dana',
    title: 'Capacity Building: Finance Systems',
    program: 'Organizational Capacity',
    status: 'PROSPECT',
    requested: '50000',
    awarded: '0',
    probability: 20,
    purpose:
      'Replaces spreadsheet-based grant tracking with an integrated finance and grant management system, including staff training and a documented month-end close process.',
    requirements: 'Meyerson does not fund capacity work as a rule. This would need a trustee champion.',
    nextAction: 'Test the idea with Judith Meyerson before the September board meeting.',
    applicationOffset: 70,
    decisionOffset: null,
    startOffset: null,
    endOffset: null,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Software & implementation', description: 'System licence and configuration', planned: '32000', spent: '0' },
      { category: 'Consulting', description: 'Process design and data migration', planned: '13000', spent: '0' },
      { category: 'Staff training', description: 'Training time and materials', planned: '5000', spent: '0' },
    ],
    milestones: [{ key: 'concept', type: 'LOI', title: 'Concept note to trustee', dueOffset: 45, status: 'NOT_STARTED', requiredEvidenceCount: 0 }],
    tasks: [
      { key: 't1', title: 'Draft a one-page concept note', status: 'TODO', priority: 'LOW', dueOffset: 38, assigneeKey: 'dana' },
      { key: 't2', title: 'Collect comparison pricing from two vendors', status: 'TODO', priority: 'LOW', dueOffset: 52, assigneeKey: 'naomi' },
    ],
    evidence: [],
    comments: [
      { authorKey: 'dana', body: 'Long shot, but the reporting burden across nine active awards is genuinely a risk. Worth one conversation.', daysAgo: 22 },
    ],
  },

  /* ---------------------------------------------------------- 13. closed */
  {
    key: 'winter-shelter',
    orgKey: 'riverbend',
    funderKey: 'nwhousing',
    ownerKey: 'marcus',
    title: 'Emergency Shelter Winter Response',
    program: 'Homelessness Prevention',
    status: 'CLOSED',
    requested: '180000',
    awarded: '180000',
    probability: null,
    purpose:
      'Overnight severe-weather shelter for up to 90 adults across two congregations, staffed nightly from November through March.',
    requirements: 'Final narrative and financial report submitted and accepted. Records retained for six years.',
    nextAction: 'No action — closed and accepted. Retained for renewal history.',
    applicationOffset: -760,
    decisionOffset: -716,
    startOffset: -700,
    endOffset: -340,
    renewalOffset: null,
    closeoutOffset: -310,
    budget: [
      { category: 'Personnel', description: 'Overnight staffing, 5 months', planned: '112000', spent: '111240' },
      { category: 'Benefits & payroll taxes', description: '22% of wages', planned: '24640', spent: '24473' },
      { category: 'Supplies', description: 'Cots, bedding, hygiene kits', planned: '22000', spent: '21870' },
      { category: 'Facility support', description: 'Congregation utilities and cleaning', planned: '15000', spent: '14980' },
      { category: 'Transportation', description: 'Shuttle from the day centre', planned: '6360', spent: '6100' },
    ],
    milestones: [
      { key: 'final', type: 'REPORT', title: 'Final narrative report', dueOffset: -320, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'finalfin', type: 'FINANCIAL_REPORT', title: 'Final financial report', dueOffset: -320, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'accept', type: 'OTHER', title: 'Funder acceptance letter received', dueOffset: -300, status: 'COMPLETE', requiredEvidenceCount: 1 },
    ],
    tasks: [
      { key: 't1', title: 'Archive shelter incident logs per retention policy', status: 'DONE', priority: 'MEDIUM', dueOffset: -305, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'Winter-Response-Final-Report.pdf',
        docType: 'NARRATIVE',
        milestoneKey: 'final',
        uploaderKey: 'marcus',
        daysAgo: 322,
        summary: ['Final narrative report: 87 average nightly guests across 142 nights.'],
      },
      {
        name: 'Winter-Response-Final-Financials.xlsx',
        docType: 'FINANCIAL',
        milestoneKey: 'finalfin',
        uploaderKey: 'naomi',
        daysAgo: 322,
        summary: ['Final expenditure report. Total spent: $178,663 of $180,000.'],
      },
      {
        name: 'NWHP-Acceptance-Letter.pdf',
        docType: 'CORRESPONDENCE',
        milestoneKey: 'accept',
        uploaderKey: 'marcus',
        daysAgo: 300,
        summary: ['Funder acceptance of the final reports. Grant closed in good standing.'],
      },
    ],
    comments: [
      { authorKey: 'marcus', body: 'Closed in good standing. Ingrid specifically noted the quality of the nightly logs, which is worth referencing in the next application.', daysAgo: 298 },
    ],
  },

  /* -------------------------------------------------------- 14. declined */
  {
    key: 'arts-in-park',
    orgKey: 'riverbend',
    funderKey: 'harborview',
    ownerKey: 'priya',
    title: 'Arts in the Park Series',
    program: 'Arts & Culture',
    status: 'DECLINED',
    requested: '35000',
    awarded: '0',
    probability: 0,
    purpose:
      'Eight free outdoor performances in two neighbourhood parks featuring local artists, with paid youth stagehand apprenticeships.',
    requirements: 'Declined for the current cycle. Feedback suggested reapplying with a stronger youth employment component.',
    nextAction: 'Reapply in the February window with the apprenticeship element expanded.',
    applicationOffset: -120,
    decisionOffset: -60,
    startOffset: null,
    endOffset: null,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Artist fees', description: '8 performances', planned: '18000', spent: '0' },
      { category: 'Youth apprentice stipends', description: '6 apprentices', planned: '9000', spent: '0' },
      { category: 'Production', description: 'Sound, staging, permits', planned: '8000', spent: '0' },
    ],
    milestones: [
      { key: 'app', type: 'APPLICATION', title: 'August cycle application', dueOffset: -120, status: 'COMPLETE', requiredEvidenceCount: 0 },
      { key: 'decision', type: 'OTHER', title: 'Decline notification received', dueOffset: -60, status: 'COMPLETE', requiredEvidenceCount: 1 },
    ],
    tasks: [
      { key: 't1', title: 'Debrief with Miriam on the decline feedback', status: 'DONE', priority: 'MEDIUM', dueOffset: -50, assigneeKey: 'priya' },
      { key: 't2', title: 'Rework the apprenticeship component for February', status: 'TODO', priority: 'LOW', dueOffset: 150, assigneeKey: 'priya' },
    ],
    evidence: [
      {
        name: 'Harborview-Decline-Notification.pdf',
        docType: 'CORRESPONDENCE',
        milestoneKey: 'decision',
        uploaderKey: 'priya',
        daysAgo: 60,
        summary: ['Decline notification for the August cycle.', 'Feedback: strengthen the youth employment component and reapply.'],
      },
    ],
    comments: [
      { authorKey: 'priya', body: 'Miriam was generous with feedback. They fund arts with a workforce angle more readily than arts alone. February resubmission is realistic.', daysAgo: 55 },
    ],
  },

  /* ------------------------------------------------------- 15. on track */
  {
    key: 'school-mental-health',
    orgKey: 'riverbend',
    funderKey: 'cascadia',
    ownerKey: 'naomi',
    title: 'School-Based Mental Health Partnership',
    program: 'Behavioral Health',
    status: 'AWARDED',
    requested: '195000',
    awarded: '195000',
    probability: null,
    purpose:
      'Places two licensed clinicians in four middle schools, providing short-term counselling and staff consultation during the school year.',
    requirements: 'Quarterly financial reporting on the Cascadia template. Narrative reporting twice a year. District data-sharing agreement must stay current.',
    nextAction: 'First quarterly financial report is due in about seven weeks; the template is already prepared.',
    applicationOffset: -120,
    decisionOffset: -72,
    startOffset: -60,
    endOffset: 305,
    renewalOffset: 285,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '2.0 FTE licensed clinicians', planned: '132000', spent: '21800' },
      { category: 'Benefits & payroll taxes', description: '25% of salaries', planned: '33000', spent: '5450' },
      { category: 'Clinical supervision', description: 'Contracted supervision hours', planned: '14000', spent: '2300' },
      { category: 'Materials & assessments', description: 'Screening tools and licences', planned: '9000', spent: '1450' },
      { category: 'Indirect (4%)', description: 'Funder-capped indirect rate', planned: '7000', spent: '1160' },
    ],
    milestones: [
      { key: 'dsa', type: 'OTHER', title: 'District data-sharing agreement signed', dueOffset: -55, status: 'COMPLETE', requiredEvidenceCount: 1 },
      { key: 'q1fin', type: 'FINANCIAL_REPORT', title: 'Q1 financial report', dueOffset: 48, status: 'NOT_STARTED', requiredEvidenceCount: 2 },
      { key: 'narrative1', type: 'REPORT', title: 'First semi-annual narrative report', dueOffset: 128, status: 'NOT_STARTED', requiredEvidenceCount: 3 },
    ],
    tasks: [
      { key: 't1', title: 'Complete clinician onboarding at all four schools', status: 'IN_PROGRESS', priority: 'MEDIUM', dueOffset: 18, assigneeKey: 'naomi' },
      { key: 't2', title: 'Set up quarterly financial template with the 4% cap', status: 'DONE', priority: 'MEDIUM', dueOffset: -20, assigneeKey: 'naomi' },
      { key: 't3', title: 'Schedule the mid-year check-in with Dr. Bennett', status: 'TODO', priority: 'LOW', dueOffset: 60, assigneeKey: 'marcus' },
    ],
    evidence: [
      {
        name: 'District-Data-Sharing-Agreement.pdf',
        docType: 'AGREEMENT',
        milestoneKey: 'dsa',
        uploaderKey: 'naomi',
        daysAgo: 56,
        summary: ['Executed data-sharing agreement with the school district.', 'Covers FERPA-compliant outcome reporting.'],
      },
    ],
    comments: [
      { authorKey: 'naomi', body: 'Both clinicians start on the same day, which makes the payroll allocation clean from day one. Template is ready for the first quarterly report.', daysAgo: 14 },
    ],
  },

  /* ------------------------------------------------ second tenant grants */
  {
    key: 'cascade-mentoring',
    orgKey: 'cascade',
    funderKey: 'cascade-tri',
    ownerKey: 'wes',
    title: 'Peer Mentoring Expansion',
    program: 'Youth Development',
    status: 'REPORTING',
    requested: '85000',
    awarded: '85000',
    probability: null,
    purpose: 'Matches 120 middle-school students with trained high-school mentors across four school sites.',
    requirements: 'Annual outcomes report with match retention and attendance data.',
    nextAction: 'Assemble match retention data for the annual report.',
    applicationOffset: -240,
    decisionOffset: -200,
    startOffset: -180,
    endOffset: 185,
    renewalOffset: 170,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: '1.5 FTE match coordinators', planned: '58000', spent: '29500' },
      { category: 'Training', description: 'Mentor training curriculum', planned: '12000', spent: '6200' },
      { category: 'Activities', description: 'Match activity fund', planned: '15000', spent: '7400' },
    ],
    milestones: [
      { key: 'annual', type: 'REPORT', title: 'Annual outcomes report', dueOffset: 26, status: 'IN_PROGRESS', requiredEvidenceCount: 2 },
    ],
    tasks: [
      { key: 't1', title: 'Export match retention data', status: 'TODO', priority: 'HIGH', dueOffset: 12, assigneeKey: 'wes' },
    ],
    evidence: [],
    comments: [{ authorKey: 'renee', body: 'Retention is up year over year. Worth leading the report with that.', daysAgo: 5 }],
  },
  {
    key: 'cascade-nutrition',
    orgKey: 'cascade',
    funderKey: 'cascade-summit',
    ownerKey: 'renee',
    title: 'After-School Nutrition & Sport',
    program: 'Health & Wellness',
    status: 'AWARDED',
    requested: '42000',
    awarded: '42000',
    probability: null,
    purpose: 'Daily after-school snacks and coaching stipends for three neighbourhood sports programmes.',
    requirements: 'Informal reporting: a short letter at the end of the season.',
    nextAction: 'Order equipment for the spring season.',
    applicationOffset: -100,
    decisionOffset: -70,
    startOffset: -55,
    endOffset: 310,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Food', description: 'Daily snacks', planned: '18000', spent: '3400' },
      { category: 'Coaching stipends', description: '6 coaches', planned: '18000', spent: '3000' },
      { category: 'Equipment', description: 'Balls, nets, uniforms', planned: '6000', spent: '0' },
    ],
    milestones: [{ key: 'letter', type: 'REPORT', title: 'Season summary letter', dueOffset: 300, status: 'NOT_STARTED', requiredEvidenceCount: 1 }],
    tasks: [{ key: 't1', title: 'Order spring equipment', status: 'TODO', priority: 'MEDIUM', dueOffset: 30, assigneeKey: 'renee' }],
    evidence: [],
    comments: [],
  },
  {
    key: 'cascade-summer',
    orgKey: 'cascade',
    funderKey: 'cascade-tri',
    ownerKey: 'wes',
    title: 'Summer Leadership Institute',
    program: 'Youth Development',
    status: 'DRAFTING',
    requested: '64000',
    awarded: '0',
    probability: 45,
    purpose: 'A three-week residential leadership programme for 40 rising high-school juniors.',
    requirements: 'Application requires a safety plan and staff-to-participant ratios.',
    nextAction: 'Finish the safety plan attachment.',
    applicationOffset: 25,
    decisionOffset: null,
    startOffset: null,
    endOffset: null,
    renewalOffset: null,
    closeoutOffset: null,
    budget: [
      { category: 'Personnel', description: 'Institute staff', planned: '38000', spent: '0' },
      { category: 'Facility', description: 'Campus housing and meals', planned: '20000', spent: '0' },
      { category: 'Transportation', description: 'Charter buses', planned: '6000', spent: '0' },
    ],
    milestones: [{ key: 'app', type: 'APPLICATION', title: 'Application submission', dueOffset: 25, status: 'IN_PROGRESS', requiredEvidenceCount: 1 }],
    tasks: [{ key: 't1', title: 'Draft the safety plan', status: 'IN_PROGRESS', priority: 'HIGH', dueOffset: 18, assigneeKey: 'wes' }],
    evidence: [],
    comments: [],
  },
];
