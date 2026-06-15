import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, setStoredToken, getStoredToken } from './api/client'
import {
  apiUserToSession, apiTrialToTrial, apiPatientToPatient, trialToApiPayload, patientToApiPayload,
} from './api/mappers'
import { setOrgUsersCache, resolveUserName } from './api/orgUsers'
import { getSessionIdleTimeoutMs, useIdleTimeout } from './hooks/useIdleTimeout'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
type Role = 'recruiter' | 'researcher' | 'admin'
type RecruitStage = 'Identified' | 'Eligible' | 'Contacted' | 'Interested' | 'Consented'
type RiskLevel = 'low' | 'medium' | 'high'
type OutreachStatus = 'sent' | 'delivered' | 'opened' | 'responded' | 'scheduled' | 'failed'
type NotifType = 'ai' | 'outreach' | 'stage' | 'system'
type Page = 'trials' | 'documents' | 'dashboard' | 'patients' | 'pipeline' | 'ai' | 'outreach' | 'analytics' | 'admin'
type TrialRecruitmentStatus = 'Planned' | 'Enrolling' | 'Recruiting' | 'Paused' | 'Completed' | 'Archived'
type DocCategory = 'protocol' | 'inclusion_exclusion' | 'recruitment_sop' | 'site_instructions' | 'irb' | 'recruitment_flyer' | 'consent_template' | 'sponsor_guidance'

interface LabResult { name: string; value: number; unit: string; normal: string; flag?: 'H' | 'L' }
interface MedHistory { date: string; event: string; detail: string; type: 'diagnosis' | 'procedure' | 'hospitalization' | 'other' }
interface Medication { name: string; dose: string; frequency: string; since: string }
interface AIReason { feature: string; passed: boolean; weight: number; detail: string }
interface RiskFlag { type: string; level: RiskLevel; note: string }
interface OutreachRecord { id: string; channel: 'email' | 'sms' | 'call'; template: string; sentAt: string; status: OutreachStatus; note?: string; followUpDate?: string }
interface ActivityLogEntry { id: string; type: 'stage' | 'outreach' | 'note' | 'ai' | 'flag'; message: string; timestamp: string }
interface TrialSite { id: string; name: string; city: string; country: string }

export interface Patient {
  id: string; trialId: string; name: string; age: number; gender: 'M' | 'F' | 'Other'; diagnosis: string; condition: string
  stage: RecruitStage; eligibilityScore: number; aiConfidence: number; riskLevel: RiskLevel
  reasons: AIReason[]; riskFlags: RiskFlag[]; history: MedHistory[]; medications: Medication[]
  labResults: LabResult[]; outreach: OutreachRecord[]; notes: string[]; activityLog: ActivityLogEntry[]
  flagged?: boolean; lastContact?: string; tags: string[]; uploadedAt: string
}
export interface Trial {
  id: string
  title: string
  protocolId: string
  sponsor: string
  phase: string
  therapeuticArea: string
  condition: string
  description: string
  recruitmentTarget: number
  enrollmentGoal: number
  enrollmentTarget: number
  recruitmentStatus: TrialRecruitmentStatus
  ageRange: { min: number; max: number }
  targetConditions: string[]
  sites: TrialSite[]
  startDate: string
  endDate: string
  ownerId: string
  recruiterIds: string[]
  archived: boolean
  createdAt: string
  updatedAt: string
  protocolCriteria?: ProtocolCriteriaExtract
  protocolCriteriaUpdatedAt?: string
}
interface DocVersion {
  version: number
  label: string
  uploadedAt: string
  uploadedBy: string
  fileName: string
  fileSizeKb: number
  notes?: string
}
interface ProtocolCriteriaExtract {
  sourceDocId: string
  sourceDocTitle: string
  parsedAt: string
  inclusion: string[]
  exclusion: string[]
  biomarkers: string[]
  ageMin: number
  ageMax: number
  visitRequirements: string[]
  searchableText: string
}
interface TrialDocument {
  id: string
  trialId: string
  title: string
  category: DocCategory
  fileName: string
  mimeType: string
  versions: DocVersion[]
  currentVersion: number
  expiryDate?: string
  tags: string[]
  contentPreview: string
  parsedCriteria?: ProtocolCriteriaExtract
  uploadedBy: string
  updatedAt: string
}
interface Notification { id: string; type: NotifType; title: string; body: string; read: boolean; ts: string }
interface Toast { id: number; msg: string; type: 'ok' | 'warn' | 'err' }
export interface DemoUser { id: string; name: string; role: Role; email: string }

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════
const C = {
  bg: '#F0F4FF', white: '#FFFFFF', border: '#E2EBF8', navy: '#0F2557', blue: '#1A56DB',
  blueLight: '#EBF0FF', teal: '#0694A2', purple: '#6D28D9', text: '#0F172A', muted: '#64748B',
  slate: '#94A3B8', cardShadow: '0 2px 16px rgba(15, 37, 87, 0.06)',
  elevated: '0 8px 40px rgba(15, 37, 87, 0.14)',
}
const flex: CSSProperties = { display: 'flex' }
const flexCol: CSSProperties = { display: 'flex', flexDirection: 'column' }
const flexCenter: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center' }
const flexBetween: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }

const STAGES: RecruitStage[] = ['Identified', 'Eligible', 'Contacted', 'Interested', 'Consented']
const STAGE_META: Record<RecruitStage, { color: string; bg: string; border: string; icon: string }> = {
  Identified: { color: '#475569', bg: '#F8FAFC', border: '#E2E8F0', icon: '🔍' },
  Eligible: { color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE', icon: '✅' },
  Contacted: { color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', icon: '📞' },
  Interested: { color: '#0F766E', bg: '#F0FDFA', border: '#99F6E4', icon: '💬' },
  Consented: { color: '#047857', bg: '#ECFDF5', border: '#A7F3D0', icon: '📋' },
}
const RISK_META: Record<RiskLevel, { text: string; bg: string; border: string }> = {
  low: { text: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
  medium: { text: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  high: { text: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' },
}
const ROLE_META: Record<Role, { label: string; color: string; bg: string }> = {
  admin: { label: 'Admin', color: '#6D28D9', bg: '#F5F3FF' },
  researcher: { label: 'Researcher', color: '#0F766E', bg: '#F0FDFA' },
  recruiter: { label: 'Recruiter', color: '#1D4ED8', bg: '#EFF6FF' },
}
const DOC_CATEGORY_META: Record<DocCategory, { label: string; icon: string }> = {
  protocol: { label: 'Protocol document', icon: '📋' },
  inclusion_exclusion: { label: 'Inclusion / exclusion guidelines', icon: '✅' },
  recruitment_sop: { label: 'Recruitment SOP', icon: '📑' },
  site_instructions: { label: 'Site instructions', icon: '🏥' },
  irb: { label: 'IRB document', icon: '⚖️' },
  recruitment_flyer: { label: 'Recruitment flyer', icon: '📢' },
  consent_template: { label: 'Consent template', icon: '✍️' },
  sponsor_guidance: { label: 'Sponsor guidance', icon: '🏢' },
}
const NAV_ITEMS: { id: Page; label: string; icon: string; roles: Role[] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'trials', label: 'Trials', icon: '🧪', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'documents', label: 'Document Center', icon: '📁', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'patients', label: 'Patients', icon: '👥', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'ai', label: 'AI Matching', icon: '🤖', roles: ['admin', 'researcher'] },
  { id: 'pipeline', label: 'Recruitment Pipeline', icon: '🔄', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'outreach', label: 'Outreach', icon: '📤', roles: ['admin', 'researcher', 'recruiter'] },
  { id: 'analytics', label: 'Analytics', icon: '📊', roles: ['admin', 'researcher'] },
  { id: 'admin', label: 'Admin Settings', icon: '⚙️', roles: ['admin'] },
]
const AI_FEATURE_BANK: AIReason[] = [
  { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Patient age falls within required 45–75 range' },
  { feature: 'Primary condition match', passed: true, weight: 30, detail: 'Type 2 Diabetes confirmed matching protocol target' },
  { feature: 'HbA1c ≥ 7.5%', passed: true, weight: 20, detail: 'HbA1c = 8.2% exceeds minimum threshold' },
  { feature: 'eGFR ≥ 45 mL/min', passed: true, weight: 15, detail: 'Renal function adequate for study participation' },
  { feature: 'No prior GLP-1 therapy', passed: true, weight: 10, detail: 'Patient naïve to GLP-1 receptor agonists' },
  { feature: 'BMI in eligible range', passed: true, weight: 5, detail: 'BMI 28.4 within 25–40 kg/m² window' },
  { feature: 'History of stroke excluded', passed: true, weight: 15, detail: 'No cerebrovascular events in medical history' },
  { feature: 'Active cancer exclusion', passed: false, weight: 20, detail: 'Patient has active malignancy — excludes participation' },
  { feature: 'Severe renal impairment', passed: false, weight: 20, detail: 'eGFR < 30 — protocol exclusion criterion met' },
  { feature: 'Comorbidity burden acceptable', passed: true, weight: 10, detail: 'Comorbidity index within acceptable range' },
  { feature: 'Medication interaction check', passed: true, weight: 8, detail: 'No contraindicated medications identified' },
  { feature: 'Prior trial participation', passed: false, weight: 12, detail: 'Patient enrolled in competing trial within 6 months' },
  { feature: 'Informed consent capacity', passed: true, weight: 5, detail: 'No cognitive impairment flagged' },
  { feature: 'Cardiovascular safety profile', passed: true, weight: 15, detail: 'MACE risk within acceptable threshold' },
]
const MSG_TEMPLATES = [
  { id: 't1', name: 'Initial Outreach', body: "Dear {name}, you may be eligible for our clinical trial. We'd love to tell you more." },
  { id: 't2', name: 'Follow-up', body: 'Dear {name}, we wanted to follow up on our previous message about the study.' },
  { id: 't3', name: 'Consent Confirmation', body: 'Dear {name}, please find attached the consent documentation for your review.' },
  { id: 't4', name: 'Appointment Reminder', body: 'Dear {name}, this is a reminder of your appointment scheduled for next week.' },
]
const DEMO_USERS: DemoUser[] = [
  { id: 'u1', name: 'Dr. Sarah Chen', role: 'admin', email: 'sarah@clinic.org' },
  { id: 'u2', name: 'Dr. James Okafor', role: 'researcher', email: 'james@clinic.org' },
  { id: 'u3', name: 'Lisa Park', role: 'recruiter', email: 'lisa@clinic.org' },
]
const OUTREACH_STATUS_LABELS: Record<string, string> = {
  sent: 'Sent', delivered: 'Delivered', opened: 'Opened', responded: 'Responded', scheduled: 'Scheduled', failed: 'Failed',
}

// ═══════════════════════════════════════════════════════════════════
// AI ENGINE
// ═══════════════════════════════════════════════════════════════════
function scoreToRiskLevel(score: number, flagCount: number): RiskLevel {
  if (score < 50 || flagCount > 1) return 'high'
  if (score < 70 || flagCount > 0) return 'medium'
  return 'low'
}
function recommendStage(score: number, current: RecruitStage): RecruitStage {
  if (score >= 70 && current === 'Identified') return 'Eligible'
  if (score < 40 && current === 'Eligible') return 'Identified'
  return current
}
function trialAgeRange(trial: Trial): { min: number; max: number } {
  const c = trial.protocolCriteria
  return c ? { min: c.ageMin, max: c.ageMax } : trial.ageRange
}

function runAIEngine(patient: Patient, trial?: Trial): Partial<Patient> {
  const pool = [...AI_FEATURE_BANK]
  const reasons: AIReason[] = []
  const crit = trial?.protocolCriteria
  if (crit) {
    crit.inclusion.slice(0, 3).forEach((inc, idx) => {
      const kw = inc.toLowerCase().split(/\s+/).find((w) => w.length > 4) ?? ''
      const passed = kw ? patient.diagnosis.toLowerCase().includes(kw) || patient.condition.toLowerCase().includes(kw) : Math.random() > 0.3
      reasons.push({ feature: `Protocol inclusion: ${inc.slice(0, 42)}${inc.length > 42 ? '…' : ''}`, passed, weight: 12 - idx, detail: passed ? 'Aligned with parsed protocol inclusion criteria' : 'Does not match parsed inclusion criterion' })
    })
    crit.exclusion.slice(0, 2).forEach((exc) => {
      const kw = exc.toLowerCase().split(/\s+/).find((w) => w.length > 4) ?? ''
      const triggered = kw && (patient.diagnosis.toLowerCase().includes(kw) || patient.history.some((h) => h.event.toLowerCase().includes(kw)))
      reasons.push({ feature: `Protocol exclusion: ${exc.slice(0, 40)}…`, passed: !triggered, weight: 18, detail: triggered ? 'Potential exclusion per protocol document' : 'No exclusion trigger from protocol rules' })
    })
    crit.biomarkers.slice(0, 2).forEach((bio) => {
      const hasLab = patient.labResults.some((l) => l.name.toLowerCase().includes(bio.toLowerCase().split(/[\s(]/)[0]))
      reasons.push({ feature: `Biomarker: ${bio}`, passed: hasLab || Math.random() > 0.35, weight: 14, detail: hasLab ? 'Lab data available for biomarker evaluation' : 'Biomarker lab not on file — upload labs for full check' })
    })
  }
  const n = Math.max(6, 6 + Math.floor(Math.random() * 4) - reasons.length)
  const used = new Set<number>()
  while (reasons.length < n) {
    const i = Math.floor(Math.random() * pool.length)
    if (!used.has(i)) { used.add(i); reasons.push({ ...pool[i], passed: Math.random() > 0.25 }) }
  }
  if (trial) {
    const { min, max } = trialAgeRange(trial)
    const ageIdx = reasons.findIndex((r) => r.feature.toLowerCase().includes('age'))
    if (ageIdx >= 0) {
      const ageOk = patient.age >= min && patient.age <= max
      reasons[ageIdx] = { ...reasons[ageIdx], passed: ageOk, detail: ageOk ? `Age ${patient.age} within protocol ${min}–${max} (document center)` : `Age ${patient.age} outside protocol ${min}–${max}` }
    }
  }
  const score = Math.min(100, Math.max(5, reasons.filter((r) => r.passed).reduce((s, r) => s + r.weight, 0) + Math.floor(Math.random() * 15)))
  const confidence = Math.min(98, 55 + Math.floor(Math.random() * 40))
  const flags: RiskFlag[] = []
  if (score < 50) flags.push({ type: 'Low eligibility', level: 'high', note: 'Multiple exclusion criteria triggered' })
  if (Math.random() > 0.7) flags.push({ type: 'Dropout risk', level: Math.random() > 0.5 ? 'medium' : 'low', note: 'Patient history suggests potential non-adherence' })
  const riskLevel = scoreToRiskLevel(score, flags.length)
  const stage = recommendStage(score, patient.stage)
  return {
    eligibilityScore: score, aiConfidence: confidence, reasons, riskFlags: flags, riskLevel, stage,
    activityLog: [{ id: `act-${Date.now()}`, type: 'ai', message: `AI re-scored: ${score}% eligibility, ${confidence}% confidence`, timestamp: new Date().toISOString() }, ...patient.activityLog],
  }
}
function getScoreColor(score: number): string {
  if (score >= 75) return '#059669'
  if (score >= 50) return '#D97706'
  return '#DC2626'
}
function getScoreBarColor(score: number): string {
  return getScoreColor(score)
}
function canAccessPage(role: Role, page: Page): boolean {
  return NAV_ITEMS.some((n) => n.id === page && n.roles.includes(role))
}
function canRunAI(role: Role): boolean { return role === 'admin' || role === 'researcher' }
function canMoveStage(role: Role): boolean { return role !== 'researcher' }
function canManageOutreach(role: Role): boolean { return role === 'admin' || role === 'recruiter' }
function canAdminSettings(role: Role): boolean { return role === 'admin' }
function canManageTrials(role: Role): boolean { return role === 'admin' }
function canAddPatients(role: Role): boolean { return role === 'admin' || role === 'recruiter' || role === 'researcher' }

interface PatientImportRow {
  name: string
  age: number
  gender: 'M' | 'F' | 'Other'
  condition: string
  diagnosis?: string
  stage?: RecruitStage
  notes?: string
}

function nextPatientId(existing: Patient[]): string {
  let n = 1
  while (existing.some((p) => p.id === `PT-${String(n).padStart(3, '0')}`)) n++
  return `PT-${String(n).padStart(3, '0')}`
}

function buildPatientFromImport(row: PatientImportRow, trialId: string, id: string): Patient {
  return enrich({
    id,
    trialId,
    name: row.name.trim(),
    age: row.age,
    gender: row.gender,
    condition: row.condition.trim(),
    diagnosis: row.diagnosis?.trim(),
    stage: row.stage ?? 'Identified',
    eligibilityScore: 0,
    aiConfidence: 0,
    reasons: [],
    riskFlags: [],
    history: [],
    medications: [],
    labResults: [],
    outreach: [],
    notes: row.notes ? [row.notes] : [],
    tags: ['Imported'],
    uploadedAt: TODAY,
  })
}

function parseGender(raw: string): 'M' | 'F' | 'Other' {
  const g = raw.trim().toLowerCase()
  if (g === 'm' || g === 'male') return 'M'
  if (g === 'f' || g === 'female') return 'F'
  return 'Other'
}

function parseStage(raw: string): RecruitStage | undefined {
  const hit = STAGES.find((s) => s.toLowerCase() === raw.trim().toLowerCase())
  return hit
}

function parseCsvPatients(text: string, delimiter = ','): PatientImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/"/g, ''))
  const idx = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)))
  const nameI = idx(['name', 'patient'])
  const ageI = idx(['age'])
  const genderI = idx(['gender', 'sex'])
  const condI = idx(['condition', 'diagnosis', 'disease'])
  const stageI = idx(['stage', 'status'])
  const notesI = idx(['note', 'comment'])
  if (nameI < 0 || ageI < 0) return []
  return lines.slice(1).flatMap((line): PatientImportRow[] => {
    const cols = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''))
    const age = parseInt(cols[ageI] ?? '', 10)
    if (!cols[nameI] || Number.isNaN(age)) return []
    const row: PatientImportRow = {
      name: cols[nameI],
      age,
      gender: genderI >= 0 ? parseGender(cols[genderI] || 'Other') : 'Other',
      condition: cols[condI] ?? 'Unknown',
      stage: stageI >= 0 ? parseStage(cols[stageI] ?? '') : undefined,
      notes: notesI >= 0 ? cols[notesI] : undefined,
    }
    if (condI >= 0 && cols[condI]) row.diagnosis = cols[condI]
    return [row]
  })
}

function parseJsonPatients(text: string): PatientImportRow[] {
  const data = JSON.parse(text) as unknown
  const arr = Array.isArray(data) ? data : (data as { patients?: unknown[] })?.patients
  if (!Array.isArray(arr)) return []
  return arr.flatMap((item): PatientImportRow[] => {
    const o = item as Record<string, unknown>
    const age = typeof o.age === 'number' ? o.age : parseInt(String(o.age ?? ''), 10)
    if (!o.name || Number.isNaN(age)) return []
    const row: PatientImportRow = {
      name: String(o.name),
      age,
      gender: parseGender(String(o.gender ?? 'Other')),
      condition: String(o.condition ?? o.diagnosis ?? 'Unknown'),
      stage: o.stage ? parseStage(String(o.stage)) : undefined,
      notes: o.notes ? String(o.notes) : undefined,
    }
    if (o.diagnosis) row.diagnosis = String(o.diagnosis)
    return [row]
  })
}

function parsePdfTextPatients(text: string, trial: Trial): PatientImportRow[] {
  const rows: PatientImportRow[] = []
  const blocks = text.split(/\n{2,}|(?=Patient\s*#?\d|Name\s*:)/i)
  blocks.forEach((block) => {
    const name = block.match(/(?:name|patient)\s*[:=]\s*([^\n,]+)/i)?.[1]?.trim()
    const age = parseInt(block.match(/age\s*[:=]\s*(\d{1,3})/i)?.[1] ?? '', 10)
    const condition = block.match(/(?:condition|diagnosis)\s*[:=]\s*([^\n]+)/i)?.[1]?.trim()
    if (name && !Number.isNaN(age)) {
      rows.push({
        name,
        age,
        gender: parseGender(block.match(/gender\s*[:=]\s*(\w+)/i)?.[1] ?? 'Other'),
        condition: condition ?? trial.condition,
        diagnosis: condition,
        stage: parseStage(block.match(/stage\s*[:=]\s*(\w+)/i)?.[1] ?? ''),
        notes: 'Imported from PDF',
      })
    }
  })
  if (rows.length > 0) return rows
  const lines = text.split('\n').filter((l) => l.trim().length > 3)
  lines.slice(0, 20).forEach((line, i) => {
    const parts = line.split(/[,|\t]/).map((p) => p.trim())
    if (parts.length >= 2) {
      const age = parseInt(parts[1], 10)
      if (!Number.isNaN(age) && parts[0].length > 2) {
        rows.push({ name: parts[0], age, gender: 'Other', condition: parts[2] ?? trial.condition, notes: 'PDF line extract' })
      }
    } else if (i < 5) {
      rows.push({ name: `PDF import ${i + 1}`, age: 50 + i, gender: 'Other', condition: trial.condition, notes: line.slice(0, 80) })
    }
  })
  return rows
}

async function parseBulkPatientFile(file: File, trial: Trial): Promise<{ rows: PatientImportRow[]; source: string }> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  await new Promise((r) => setTimeout(r, ext === 'pdf' || ext === 'xlsx' || ext === 'xls' ? 1600 : 600))

  if (ext === 'json') {
    const text = await file.text()
    return { rows: parseJsonPatients(text), source: 'JSON' }
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = await file.text()
    const delim = ext === 'tsv' || text.includes('\t') ? '\t' : ','
    return { rows: parseCsvPatients(text, delim), source: ext.toUpperCase() }
  }
  if (ext === 'pdf') {
    const text = await file.text().catch(() => '')
    const rows = text.length > 20 ? parsePdfTextPatients(text, trial) : []
    if (rows.length > 0) return { rows, source: 'PDF text' }
    return {
      rows: [
        { name: 'PDF Extract — Patient A', age: 55, gender: 'M', condition: trial.condition, notes: `Demo OCR from ${file.name}` },
        { name: 'PDF Extract — Patient B', age: 61, gender: 'F', condition: trial.condition, notes: `Demo OCR from ${file.name}` },
      ],
      source: 'PDF (AI demo)',
    }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const text = await file.text().catch(() => '')
    const csvRows = text.includes(',') ? parseCsvPatients(text) : []
    if (csvRows.length > 0) return { rows: csvRows, source: 'Excel/CSV' }
    return {
      rows: [
        { name: 'Excel Row 1', age: 52, gender: 'F', condition: trial.condition, stage: 'Identified' },
        { name: 'Excel Row 2', age: 64, gender: 'M', condition: trial.condition, stage: 'Identified' },
        { name: 'Excel Row 3', age: 48, gender: 'F', condition: trial.condition, stage: 'Identified' },
      ],
      source: 'Excel (demo parser)',
    }
  }
  throw new Error('Unsupported file type. Use CSV, JSON, PDF, Excel, or TXT.')
}

const BULK_TEMPLATE_CSV = `name,age,gender,condition,stage,notes
Jane Doe,54,F,Type 2 Diabetes,Identified,Referral from PCP
John Smith,67,M,Type 2 Diabetes,Identified,
`

function userName(id: string): string {
  return resolveUserName(id, 'User')
}

function syncTrialEnrollment(t: Trial): Trial {
  return { ...t, enrollmentTarget: t.enrollmentGoal }
}

const TRIAL_STATUS_META: Record<TrialRecruitmentStatus, { label: string; color: string; bg: string; border: string }> = {
  Planned: { label: 'Planned', color: '#475569', bg: '#F8FAFC', border: '#E2E8F0' },
  Enrolling: { label: 'Enrolling', color: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' },
  Recruiting: { label: 'Recruiting', color: '#0F766E', bg: '#F0FDFA', border: '#99F6E4' },
  Paused: { label: 'Paused', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  Completed: { label: 'Completed', color: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
  Archived: { label: 'Archived', color: '#64748B', bg: '#F1F5F9', border: '#CBD5E1' },
}

function TrialStatusBadge({ status }: { status: TrialRecruitmentStatus }) {
  const m = TRIAL_STATUS_META[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
      {m.label}
    </span>
  )
}

function getMissingDataWarnings(patient: Patient, trial: Trial): string[] {
  const warnings: string[] = []
  const { min, max } = trialAgeRange(trial)
  if (!trial.protocolCriteria) warnings.push('No parsed protocol on file — using trial defaults; upload protocol PDF in Document Center')
  if (patient.labResults.length === 0) warnings.push('No lab results on file — biomarker matching limited')
  if (patient.medications.length === 0) warnings.push('Medication history missing — interaction check incomplete')
  if (patient.history.length === 0) warnings.push('Medical history empty — exclusion screening may be incomplete')
  if (patient.age < min || patient.age > max) {
    warnings.push(`Age ${patient.age} outside protocol range ${min}–${max}`)
  }
  if (trial.protocolCriteria && patient.labResults.length === 0 && trial.protocolCriteria.biomarkers.length > 0) {
    warnings.push(`Protocol requires biomarkers (${trial.protocolCriteria.biomarkers.slice(0, 2).join(', ')}) — labs missing`)
  }
  if (['Contacted', 'Interested', 'Consented'].includes(patient.stage) && !patient.lastContact) {
    warnings.push('No last contact date recorded for active recruitment stage')
  }
  if (patient.reasons.length < 4) warnings.push('Limited AI criteria evaluated — confidence may be lower')
  return warnings
}

function getProtocolChecks(patient: Patient, trial: Trial): { label: string; passed: boolean; detail: string }[] {
  const { min, max } = trialAgeRange(trial)
  const ageOk = patient.age >= min && patient.age <= max
  const condOk = trial.targetConditions.some(
    (t) => patient.diagnosis.toLowerCase().includes(t.toLowerCase()) || patient.condition.toLowerCase().includes(t.toLowerCase()),
  )
  const crit = trial.protocolCriteria
  const biomarkerTerms = crit?.biomarkers.length ? crit.biomarkers : ['hba1c', 'egfr', 'fev1']
  const biomarkerOk = patient.labResults.some((l) => biomarkerTerms.some((b) => l.name.toLowerCase().includes(b.toLowerCase().split(/[\s(]/)[0])))
  const exclusionAlert = patient.reasons.some((r) => !r.passed && r.weight >= 15)
  const checks = [
    { label: 'Age compatibility', passed: ageOk, detail: ageOk ? `Age ${patient.age} within ${min}–${max}${crit ? ' (protocol doc)' : ''}` : `Age ${patient.age} outside protocol window` },
    { label: 'Diagnosis match', passed: condOk, detail: condOk ? `Matches target: ${trial.condition}` : 'Primary diagnosis may not match protocol target' },
    { label: 'Biomarker data', passed: biomarkerOk, detail: biomarkerOk ? 'Key labs available for protocol biomarkers' : `Missing labs for: ${biomarkerTerms.slice(0, 2).join(', ')}` },
    { label: 'Exclusion screening', passed: !exclusionAlert, detail: exclusionAlert ? 'One or more major exclusion criteria triggered' : 'No major exclusion alerts from AI rules' },
  ]
  if (crit && crit.inclusion.length > 0) {
    const inc = crit.inclusion[0]
    const incOk = patient.diagnosis.toLowerCase().includes(trial.condition.toLowerCase().split(' ')[0]) || patient.condition.toLowerCase().includes(trial.condition.toLowerCase().split(' ')[0])
    checks.push({ label: 'Primary inclusion (doc)', passed: incOk, detail: incOk ? `Meets: ${inc.slice(0, 55)}…` : `Review: ${inc.slice(0, 55)}…` })
  }
  return checks
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function docExpiryStatus(expiryDate?: string): 'ok' | 'soon' | 'expired' | null {
  if (!expiryDate) return null
  const d = daysUntil(expiryDate)
  if (d < 0) return 'expired'
  if (d <= 30) return 'soon'
  return 'ok'
}

function getTrialDocuments(docs: TrialDocument[], trialId: string): TrialDocument[] {
  return docs.filter((d) => d.trialId === trialId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function parseProtocolFromDocument(trial: Trial, doc: TrialDocument): ProtocolCriteriaExtract {
  const base: ProtocolCriteriaExtract = {
    sourceDocId: doc.id,
    sourceDocTitle: doc.title,
    parsedAt: new Date().toISOString(),
    inclusion: [],
    exclusion: [],
    biomarkers: [],
    ageMin: trial.ageRange.min,
    ageMax: trial.ageRange.max,
    visitRequirements: [],
    searchableText: doc.contentPreview,
  }
  if (trial.id === 'T1') {
    return {
      ...base,
      inclusion: [
        'Adults 50–75 with Type 2 Diabetes on stable metformin ≥ 3 months',
        'HbA1c ≥ 7.5% at screening',
        'BMI 25–40 kg/m²',
        'Willing to comply with visit schedule and eDiary',
      ],
      exclusion: [
        'Prior GLP-1 receptor agonist within 12 months',
        'eGFR < 30 mL/min/1.73m²',
        'History of stroke or TIA within 6 months',
        'Active malignancy or pregnancy',
      ],
      biomarkers: ['HbA1c ≥ 7.5%', 'eGFR ≥ 45 mL/min', 'Fasting glucose'],
      ageMin: 50,
      ageMax: 75,
      visitRequirements: ['Screening (Day -14 to -1)', 'Baseline (Day 1)', 'Week 4, 12, 24, 52', 'Safety labs at each visit'],
      searchableText: `${doc.contentPreview} inclusion HbA1c diabetes metformin exclusion GLP-1 eGFR stroke biomarker visit schedule`,
    }
  }
  if (trial.id === 'T2') {
    return {
      ...base,
      inclusion: [
        'Moderate-to-severe COPD (GOLD II–III) with FEV1 30–70% predicted',
        'Age 40–75, on stable bronchodilator therapy ≥ 8 weeks',
        '≥ 10 pack-year smoking history or documented biomass exposure',
      ],
      exclusion: [
        'COPD exacerbation requiring steroids/antibiotics within 30 days',
        'Asthma as primary diagnosis',
        'Supplemental oxygen > 12 hours/day at baseline',
        'Alpha-1 antitrypsin deficiency unless treated',
      ],
      biomarkers: ['FEV1 % predicted', 'FEV1/FVC ratio', 'CAT score ≥ 10'],
      ageMin: 40,
      ageMax: 75,
      visitRequirements: ['Screening spirometry', 'Randomization (Day 1)', 'Week 4, 8, 12 endpoints', 'Rescue medication log'],
      searchableText: `${doc.contentPreview} COPD exclusion exacerbation FEV1 biomarker spirometry recruitment`,
    }
  }
  return {
    ...base,
    inclusion: [
      `Idiopathic Parkinson's Disease per UK Brain Bank criteria`,
      'Hoehn & Yahr stage 1–3, stable medication ≥ 4 weeks',
      'Age 45–70 with capacity to consent',
    ],
    exclusion: [
      'Atypical parkinsonism or secondary causes',
      'Deep brain stimulation within 12 months',
      'MoCA < 24 indicating significant cognitive impairment',
    ],
    biomarkers: ['DaTscan confirmation (optional)', 'UPDRS Part III', 'MDS-UPDRS'],
    ageMin: 45,
    ageMax: 70,
    visitRequirements: ['Screening (2 visits)', 'Baseline motor assessment', 'Week 2, 4, 8 safety'],
    searchableText: `${doc.contentPreview} Parkinson inclusion exclusion UPDRS visit biomarker`,
  }
}

function applyCriteriaToTrial(trial: Trial, criteria: ProtocolCriteriaExtract): Trial {
  return {
    ...trial,
    protocolCriteria: criteria,
    protocolCriteriaUpdatedAt: criteria.parsedAt,
    ageRange: { min: criteria.ageMin, max: criteria.ageMax },
    updatedAt: TODAY,
  }
}

function mkDocVersion(v: number, fileName: string, uploadedBy: string, notes?: string): DocVersion {
  return { version: v, label: `v${v}`, uploadedAt: TODAY, uploadedBy, fileName, fileSizeKb: 800 + v * 120, notes }
}

// ═══════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════
export const TODAY = new Date().toISOString().slice(0, 10)
export const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

const mkTrial = (t: Omit<Trial, 'enrollmentTarget' | 'createdAt' | 'updatedAt'> & Partial<Pick<Trial, 'createdAt' | 'updatedAt'>>): Trial => {
  const now = TODAY
  return syncTrialEnrollment({
    ...t,
    enrollmentTarget: t.enrollmentGoal,
    createdAt: t.createdAt ?? now,
    updatedAt: t.updatedAt ?? now,
  })
}

export const SEED_TRIALS: Trial[] = [
  mkTrial({
    id: 'T1',
    title: 'GLYCOCONTROL-301',
    protocolId: 'GLYCO-301',
    phase: 'Phase III',
    therapeuticArea: 'Endocrinology',
    condition: 'Type 2 Diabetes',
    description: 'A randomized study evaluating glycemic control in adults with Type 2 Diabetes inadequately controlled on metformin.',
    sponsor: 'BioPharma Research Inc.',
    recruitmentTarget: 120,
    enrollmentGoal: 60,
    recruitmentStatus: 'Enrolling',
    ageRange: { min: 50, max: 75 },
    targetConditions: ['Type 2 Diabetes', 'T2DM'],
    sites: [
      { id: 's1', name: 'Metro Diabetes Center', city: 'Boston', country: 'USA' },
      { id: 's2', name: 'University Hospital East', city: 'Chicago', country: 'USA' },
      { id: 's3', name: 'Pacific Clinical Research', city: 'San Diego', country: 'USA' },
    ],
    startDate: daysAgo(90),
    endDate: daysAgo(-365),
    ownerId: 'u1',
    recruiterIds: ['u3', 'u1'],
    archived: false,
  }),
  mkTrial({
    id: 'T2',
    title: 'RESPIRA-204',
    protocolId: 'RESP-204',
    phase: 'Phase II',
    therapeuticArea: 'Pulmonology',
    condition: 'COPD',
    description: 'Study of inhaled therapy in moderate-to-severe COPD patients with symptomatic disease despite standard care.',
    sponsor: 'LungHealth Therapeutics',
    recruitmentTarget: 80,
    enrollmentGoal: 45,
    recruitmentStatus: 'Recruiting',
    ageRange: { min: 40, max: 75 },
    targetConditions: ['COPD', 'Chronic Obstructive Pulmonary Disease'],
    sites: [
      { id: 's4', name: 'National Lung Institute', city: 'Denver', country: 'USA' },
      { id: 's5', name: 'Coastal Pulmonary Associates', city: 'Miami', country: 'USA' },
    ],
    startDate: daysAgo(45),
    endDate: daysAgo(-180),
    ownerId: 'u2',
    recruiterIds: ['u3'],
    archived: false,
  }),
  mkTrial({
    id: 'T3',
    title: 'NEUROGUARD-101',
    protocolId: 'NEURO-101',
    phase: 'Phase I',
    therapeuticArea: 'Neurology',
    condition: "Parkinson's Disease",
    description: 'Early-phase safety and tolerability study — recruitment not yet open.',
    sponsor: 'NeuroAdvance Labs',
    recruitmentTarget: 30,
    enrollmentGoal: 24,
    recruitmentStatus: 'Planned',
    ageRange: { min: 45, max: 70 },
    targetConditions: ["Parkinson's Disease", 'PD'],
    sites: [{ id: 's6', name: 'Institute of Movement Disorders', city: 'Philadelphia', country: 'USA' }],
    startDate: daysAgo(-30),
    endDate: daysAgo(-400),
    ownerId: 'u2',
    recruiterIds: [],
    archived: false,
  }),
]

/** @deprecated Use active trial from app state; kept for exports */
export const SEED_TRIAL: Trial = SEED_TRIALS[0]

export const SEED_TRIAL_DOCUMENTS: TrialDocument[] = [
  {
    id: 'doc-t1-protocol', trialId: 'seed-t1', title: 'GLYCOCONTROL-301 Master Protocol v3.2', category: 'protocol',
    fileName: 'GLYCOCONTROL-301_Protocol_v3.2.pdf', mimeType: 'application/pdf', currentVersion: 3,
    versions: [mkDocVersion(1, 'GLYCOCONTROL-301_Protocol_v2.0.pdf', 'Dr. Sarah Chen'), mkDocVersion(2, 'GLYCOCONTROL-301_Protocol_v3.0.pdf', 'Dr. Sarah Chen'), mkDocVersion(3, 'GLYCOCONTROL-301_Protocol_v3.2.pdf', 'Dr. Sarah Chen', 'Amendment 2 — HbA1c threshold')],
    expiryDate: daysAgo(-180), tags: ['protocol', 'diabetes', 'phase-iii', 'biomarker'],
    contentPreview: 'GLYCOCONTROL-301 Phase III protocol for Type 2 Diabetes. Inclusion: adults 50–75 on metformin, HbA1c ≥ 7.5%, BMI 25–40. Exclusion: prior GLP-1 therapy, eGFR < 30, stroke within 6 months. Biomarkers: HbA1c, eGFR, fasting glucose. Visits at screening, baseline, weeks 4, 12, 24, 52.',
    uploadedBy: 'u1', updatedAt: daysAgo(5),
  },
  {
    id: 'doc-t1-ie', trialId: 'seed-t1', title: 'Inclusion / Exclusion Criteria Summary', category: 'inclusion_exclusion',
    fileName: 'GLYCO-301_IE_Criteria.pdf', mimeType: 'application/pdf', currentVersion: 2,
    versions: [mkDocVersion(1, 'GLYCO-301_IE_v1.pdf', 'Dr. Sarah Chen'), mkDocVersion(2, 'GLYCO-301_IE_Criteria.pdf', 'Dr. Sarah Chen')],
    expiryDate: daysAgo(-90), tags: ['inclusion', 'exclusion', 'screening'],
    contentPreview: 'Quick-reference inclusion exclusion for recruiters. Age 50–75, T2DM, HbA1c ≥ 7.5%. Exclude GLP-1 use, severe renal impairment, active cancer.',
    uploadedBy: 'u1', updatedAt: daysAgo(12),
  },
  {
    id: 'doc-t1-sop', trialId: 'seed-t1', title: 'Patient Recruitment SOP', category: 'recruitment_sop',
    fileName: 'Recruitment_SOP_GLYCO301.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', currentVersion: 1,
    versions: [mkDocVersion(1, 'Recruitment_SOP_GLYCO301.docx', 'Lisa Park')],
    tags: ['sop', 'recruitment', 'workflow'],
    contentPreview: 'Standard operating procedure for pre-screening, outreach scripts, eligibility verification against protocol PDF, and handoff to coordinator.',
    uploadedBy: 'u3', updatedAt: daysAgo(20),
  },
  {
    id: 'doc-t1-consent', trialId: 'seed-t1', title: 'Informed Consent Template (ICF)', category: 'consent_template',
    fileName: 'ICF_GLYCOCONTROL-301_v3.pdf', mimeType: 'application/pdf', currentVersion: 3,
    versions: [mkDocVersion(3, 'ICF_GLYCOCONTROL-301_v3.pdf', 'Dr. Sarah Chen')],
    expiryDate: daysAgo(14), tags: ['consent', 'irb-approved'],
    contentPreview: 'IRB-approved informed consent template for GLYCOCONTROL-301 including risks, visit burden, and data privacy sections.',
    uploadedBy: 'u1', updatedAt: daysAgo(8),
  },
  {
    id: 'doc-t1-flyer', trialId: 'seed-t1', title: 'Patient Recruitment Flyer', category: 'recruitment_flyer',
    fileName: 'Flyer_Diabetes_Study.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'Flyer_Diabetes_Study.pdf', 'Lisa Park')],
    tags: ['flyer', 'marketing'],
    contentPreview: 'Community recruitment flyer for adults with Type 2 Diabetes — contact site coordinator.',
    uploadedBy: 'u3', updatedAt: daysAgo(30),
  },
  {
    id: 'doc-t2-protocol', trialId: 'seed-t2', title: 'RESPIRA-204 Protocol Synopsis', category: 'protocol',
    fileName: 'RESPIRA-204_Protocol.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'RESPIRA-204_Protocol.pdf', 'Dr. James Okafor')],
    expiryDate: daysAgo(-120), tags: ['COPD', 'pulmonology', 'protocol'],
    contentPreview: 'RESPIRA-204 COPD Phase II study. Inclusion: GOLD II–III, FEV1 30–70%, age 40–75. Exclusion: COPD exacerbation within 30 days, asthma primary, oxygen > 12h/day. Biomarker: FEV1, FEV1/FVC, CAT score.',
    uploadedBy: 'u2', updatedAt: daysAgo(10),
  },
  {
    id: 'doc-t2-ie', trialId: 'seed-t2', title: 'COPD Inclusion / Exclusion Guidelines', category: 'inclusion_exclusion',
    fileName: 'RESP-204_IE_Guidelines.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'RESP-204_IE_Guidelines.pdf', 'Dr. James Okafor')],
    tags: ['COPD', 'exclusion', 'spirometry'],
    contentPreview: 'Show exclusion criteria related to COPD exacerbation, asthma overlap, and supplemental oxygen requirements. Biomarker requirements: FEV1 % predicted.',
    uploadedBy: 'u2', updatedAt: daysAgo(15),
  },
  {
    id: 'doc-t2-site', trialId: 'seed-t2', title: 'Site Instructions — Denver & Miami', category: 'site_instructions',
    fileName: 'Site_Instructions_RESP204.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'Site_Instructions_RESP204.pdf', 'Dr. James Okafor')],
    tags: ['sites', 'spirometry'],
    contentPreview: 'Site-specific spirometry calibration, referral pathways, and local COPD registry outreach procedures.',
    uploadedBy: 'u2', updatedAt: daysAgo(7),
  },
  {
    id: 'doc-t2-irb', trialId: 'seed-t2', title: 'IRB Approval Letter', category: 'irb',
    fileName: 'IRB_Approval_RESP204.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'IRB_Approval_RESP204.pdf', 'Dr. James Okafor')],
    expiryDate: daysAgo(25), tags: ['irb', 'compliance'],
    contentPreview: 'Central IRB approval for RESPIRA-204 with continuing review due in 25 days.',
    uploadedBy: 'u2', updatedAt: daysAgo(60),
  },
  {
    id: 'doc-t2-sponsor', trialId: 'seed-t2', title: 'Sponsor Recruitment Guidance', category: 'sponsor_guidance',
    fileName: 'Sponsor_Guidance_LungHealth.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'Sponsor_Guidance_LungHealth.pdf', 'Dr. James Okafor')],
    tags: ['sponsor', 'messaging'],
    contentPreview: 'LungHealth Therapeutics approved messaging, prohibited claims, and diversity enrollment targets for COPD cohort.',
    uploadedBy: 'u2', updatedAt: daysAgo(18),
  },
  {
    id: 'doc-t3-protocol', trialId: 'seed-t3', title: 'NEUROGUARD-101 Protocol (Draft)', category: 'protocol',
    fileName: 'NEUROGUARD-101_Protocol_Draft.pdf', mimeType: 'application/pdf', currentVersion: 1,
    versions: [mkDocVersion(1, 'NEUROGUARD-101_Protocol_Draft.pdf', 'Dr. James Okafor')],
    tags: ['parkinson', 'phase-i', 'draft'],
    contentPreview: "Parkinson's Disease Phase I protocol draft. Planned inclusion: idiopathic PD Hoehn & Yahr 1–3, age 45–70. Exclusion: atypical parkinsonism, DBS within 12 months.",
    uploadedBy: 'u2', updatedAt: daysAgo(3),
  },
  {
    id: 'doc-t3-sop', trialId: 'seed-t3', title: 'Pre-Recruitment Planning SOP', category: 'recruitment_sop',
    fileName: 'NEURO_PreRecruitment_SOP.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', currentVersion: 1,
    versions: [mkDocVersion(1, 'NEURO_PreRecruitment_SOP.docx', 'Dr. James Okafor')],
    tags: ['planned', 'sop'],
    contentPreview: 'Pre-recruitment checklist before site activation — document center will be source of truth once enrollment opens.',
    uploadedBy: 'u2', updatedAt: daysAgo(2),
  },
]

function seedTrialsWithProtocolCriteria(): Trial[] {
  const protoT1 = SEED_TRIAL_DOCUMENTS.find((d) => d.id === 'doc-t1-protocol')
  if (!protoT1) return SEED_TRIALS
  const t1 = SEED_TRIALS.find((t) => t.id === 'T1')
  if (!t1) return SEED_TRIALS
  const criteria = parseProtocolFromDocument(t1, protoT1)
  return SEED_TRIALS.map((t) => (t.id === 'T1' ? applyCriteriaToTrial(t, criteria) : t))
}

function seedDocumentsWithParsedProtocol(): TrialDocument[] {
  const t1 = SEED_TRIALS.find((t) => t.id === 'T1')
  const proto = SEED_TRIAL_DOCUMENTS.find((d) => d.id === 'doc-t1-protocol')
  if (!t1 || !proto) return SEED_TRIAL_DOCUMENTS
  const criteria = parseProtocolFromDocument(t1, proto)
  return SEED_TRIAL_DOCUMENTS.map((d) => (d.id === 'doc-t1-protocol' ? { ...d, parsedCriteria: criteria } : d))
}

const enrich = (p: Omit<Patient, 'diagnosis' | 'riskLevel' | 'activityLog' | 'trialId'> & { diagnosis?: string; trialId?: string }): Patient => ({
  ...p,
  trialId: p.trialId ?? 'T1',
  diagnosis: p.diagnosis ?? p.condition,
  riskLevel:
    p.riskFlags.some((f) => f.level === 'high')
      ? 'high'
      : p.riskFlags.length > 0
        ? 'medium'
        : p.eligibilityScore < 50
          ? 'high'
          : p.eligibilityScore < 70
            ? 'medium'
            : 'low',
  activityLog: [
    { id: `act-seed-${p.id}`, type: 'ai', message: 'Patient imported — initial AI eligibility scored', timestamp: new Date(Date.now() - 86400000 * 2).toISOString() },
  ],
})

export const SEED_PATIENTS: Patient[] = [
  enrich({
    id: 'PT-001',
    name: 'James Carter',
    age: 62,
    gender: 'M',
    condition: 'Type 2 Diabetes',
    stage: 'Eligible',
    eligibilityScore: 92,
    aiConfidence: 94,
    uploadedAt: daysAgo(3),
    tags: ['High priority', 'Fast responder'],
    lastContact: daysAgo(1),
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 62 within 50–75 range' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'Type 2 Diabetes confirmed' },
      { feature: 'HbA1c ≥ 7.5%', passed: true, weight: 20, detail: 'HbA1c = 8.2% — above threshold' },
      { feature: 'eGFR ≥ 45 mL/min', passed: true, weight: 15, detail: 'eGFR = 65 mL/min — adequate' },
      { feature: 'No prior GLP-1 therapy', passed: true, weight: 10, detail: 'Treatment naïve' },
      { feature: 'History of stroke excluded', passed: true, weight: 15, detail: 'No CVA history found' },
    ],
    riskFlags: [{ type: 'Hypertension', level: 'low', note: 'Controlled on medication' }],
    history: [
      { date: daysAgo(1460), event: 'Type 2 Diabetes diagnosis', detail: 'HbA1c 9.4% at diagnosis; started metformin', type: 'diagnosis' },
      { date: daysAgo(730), event: 'Cardiology consult', detail: 'Stress test normal; BP management optimized', type: 'procedure' },
      { date: daysAgo(90), event: 'Annual review', detail: 'HbA1c 8.2%; weight stable; kidney function normal', type: 'other' },
    ],
    medications: [
      { name: 'Metformin', dose: '1000mg', frequency: 'Twice daily', since: daysAgo(1460) },
      { name: 'Lisinopril', dose: '10mg', frequency: 'Once daily', since: daysAgo(730) },
    ],
    labResults: [
      { name: 'HbA1c', value: 8.2, unit: '%', normal: '4.0–5.6', flag: 'H' },
      { name: 'eGFR', value: 65, unit: 'mL/min', normal: '>60' },
      { name: 'Cholesterol', value: 198, unit: 'mg/dL', normal: '<200' },
      { name: 'Glucose', value: 142, unit: 'mg/dL', normal: '70–100', flag: 'H' },
      { name: 'Creatinine', value: 1.1, unit: 'mg/dL', normal: '0.7–1.2' },
    ],
    outreach: [
      { id: 'o1', channel: 'email', template: 'Initial Outreach', sentAt: daysAgo(1), status: 'opened' },
      { id: 'o2', channel: 'call', template: 'Follow-up Call', sentAt: daysAgo(0), status: 'responded' },
    ],
    notes: ['Patient very interested. Has support from family. Scheduling consent visit.'],
  }),
  enrich({
    id: 'PT-002',
    name: 'Maria Santos',
    age: 58,
    gender: 'F',
    condition: 'Type 2 Diabetes',
    stage: 'Interested',
    eligibilityScore: 78,
    aiConfidence: 81,
    uploadedAt: daysAgo(5),
    tags: ['Verified'],
    lastContact: daysAgo(2),
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 58 within range' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'T2DM confirmed for 4 years' },
      { feature: 'HbA1c ≥ 7.5%', passed: true, weight: 20, detail: 'HbA1c = 7.8%' },
      { feature: 'BMI in eligible range', passed: true, weight: 5, detail: 'BMI 31.2' },
      { feature: 'Prior trial participation', passed: false, weight: 12, detail: 'Prior trial 14 months ago — borderline' },
    ],
    riskFlags: [],
    history: [
      { date: daysAgo(1825), event: 'T2DM diagnosis', detail: 'Diagnosed during routine screen', type: 'diagnosis' },
      { date: daysAgo(400), event: 'Ophthalmology review', detail: 'Early background retinopathy noted', type: 'procedure' },
    ],
    medications: [
      { name: 'Metformin', dose: '500mg', frequency: 'Twice daily', since: daysAgo(1825) },
      { name: 'Sitagliptin', dose: '100mg', frequency: 'Once daily', since: daysAgo(400) },
    ],
    labResults: [
      { name: 'HbA1c', value: 7.8, unit: '%', normal: '4.0–5.6', flag: 'H' },
      { name: 'eGFR', value: 72, unit: 'mL/min', normal: '>60' },
      { name: 'Glucose', value: 128, unit: 'mg/dL', normal: '70–100', flag: 'H' },
    ],
    outreach: [{ id: 'o3', channel: 'email', template: 'Initial Outreach', sentAt: daysAgo(2), status: 'responded' }],
    notes: ['Spoke to patient — very engaged. Sending consent documents.'],
  }),
  enrich({
    id: 'PT-003',
    name: 'Robert Kim',
    age: 70,
    gender: 'M',
    condition: 'Type 2 Diabetes + CKD',
    stage: 'Contacted',
    eligibilityScore: 34,
    aiConfidence: 61,
    uploadedAt: daysAgo(7),
    tags: ['Risk flag'],
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 70 within 50–75' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'T2DM confirmed' },
      { feature: 'Severe renal impairment', passed: false, weight: 20, detail: 'eGFR = 26 — below 30 threshold' },
      { feature: 'eGFR ≥ 45 mL/min', passed: false, weight: 15, detail: 'eGFR = 26 — exclusion met' },
      { feature: 'HbA1c ≥ 7.5%', passed: true, weight: 20, detail: 'HbA1c = 9.1%' },
    ],
    riskFlags: [
      { type: 'Renal exclusion', level: 'high', note: 'eGFR < 30 — meets exclusion criterion' },
      { type: 'Dropout risk', level: 'medium', note: 'Multiple comorbidities may impact adherence' },
    ],
    history: [{ date: daysAgo(2190), event: 'T2DM + CKD diagnosis', detail: 'Advanced CKD stage 3b at initial workup', type: 'diagnosis' }],
    medications: [{ name: 'Insulin glargine', dose: '20u', frequency: 'Nightly', since: daysAgo(730) }],
    labResults: [
      { name: 'HbA1c', value: 9.1, unit: '%', normal: '4.0–5.6', flag: 'H' },
      { name: 'eGFR', value: 26, unit: 'mL/min', normal: '>60', flag: 'L' },
    ],
    outreach: [{ id: 'o4', channel: 'sms', template: 'Initial Outreach', sentAt: daysAgo(5), status: 'delivered' }],
    notes: [],
  }),
  enrich({
    id: 'PT-004',
    name: 'Linda Osei',
    age: 51,
    gender: 'F',
    condition: 'Hypertension + T2DM',
    stage: 'Identified',
    eligibilityScore: 67,
    aiConfidence: 73,
    uploadedAt: daysAgo(1),
    tags: [],
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 51 within range' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'T2DM confirmed' },
      { feature: 'HbA1c ≥ 7.5%', passed: false, weight: 20, detail: 'HbA1c = 7.1% — below 7.5 threshold' },
      { feature: 'Comorbidity burden', passed: true, weight: 10, detail: 'Hypertension controlled' },
    ],
    riskFlags: [],
    history: [
      { date: daysAgo(365), event: 'Hypertension diagnosis', detail: 'Started amlodipine', type: 'diagnosis' },
      { date: daysAgo(180), event: 'T2DM diagnosis', detail: 'HbA1c 7.4% — borderline control', type: 'diagnosis' },
    ],
    medications: [
      { name: 'Metformin', dose: '500mg', frequency: 'Once daily', since: daysAgo(180) },
      { name: 'Amlodipine', dose: '5mg', frequency: 'Once daily', since: daysAgo(365) },
    ],
    labResults: [
      { name: 'HbA1c', value: 7.1, unit: '%', normal: '4.0–5.6', flag: 'H' },
      { name: 'eGFR', value: 88, unit: 'mL/min', normal: '>60' },
      { name: 'BP', value: 134, unit: 'mmHg', normal: '<130', flag: 'H' },
    ],
    outreach: [],
    notes: [],
  }),
  enrich({
    id: 'PT-005',
    trialId: 'seed-t2',
    name: 'David Park',
    age: 48,
    gender: 'M',
    condition: 'Asthma + COPD',
    stage: 'Consented',
    eligibilityScore: 88,
    aiConfidence: 90,
    uploadedAt: daysAgo(14),
    tags: ['Consented', 'Priority'],
    lastContact: daysAgo(0),
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 48 — within 18–65' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'COPD confirmed via spirometry' },
      { feature: 'No prior GLP-1 therapy', passed: true, weight: 10, detail: 'Treatment naïve' },
      { feature: 'Comorbidity burden', passed: true, weight: 10, detail: 'Well-controlled asthma' },
      { feature: 'Informed consent capacity', passed: true, weight: 5, detail: 'Full consent capacity confirmed' },
    ],
    riskFlags: [],
    history: [{ date: daysAgo(1000), event: 'COPD diagnosis', detail: 'FEV1/FVC 0.68 — GOLD stage 2', type: 'diagnosis' }],
    medications: [
      { name: 'Salbutamol', dose: '100mcg', frequency: 'PRN', since: daysAgo(1000) },
      { name: 'Budesonide/Formoterol', dose: '400/12mcg', frequency: 'Twice daily', since: daysAgo(800) },
    ],
    labResults: [
      { name: 'FEV1', value: 62, unit: '%pred', normal: '>80', flag: 'L' },
      { name: 'SpO2', value: 96, unit: '%', normal: '>95' },
      { name: 'eGFR', value: 90, unit: 'mL/min', normal: '>60' },
    ],
    outreach: [
      { id: 'o5', channel: 'email', template: 'Consent Confirmation', sentAt: daysAgo(2), status: 'opened' },
      { id: 'o6', channel: 'call', template: 'Consent Walkthrough', sentAt: daysAgo(1), status: 'responded' },
    ],
    notes: ['Consent signed on visit. Baseline labs scheduled for next week.'],
  }),
  enrich({
    id: 'PT-006',
    trialId: 'seed-t2',
    name: 'Sara Patel',
    age: 44,
    gender: 'F',
    condition: 'COPD',
    stage: 'Identified',
    eligibilityScore: 71,
    aiConfidence: 77,
    uploadedAt: daysAgo(2),
    tags: [],
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 44 within 18–65' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'COPD confirmed' },
      { feature: 'Medication interaction', passed: true, weight: 8, detail: 'No contraindications identified' },
    ],
    riskFlags: [{ type: 'Adherence concern', level: 'medium', note: 'Missed 2 of last 5 follow-up appointments' }],
    history: [{ date: daysAgo(500), event: 'COPD diagnosis', detail: 'Symptomatic with exertional dyspnea', type: 'diagnosis' }],
    medications: [{ name: 'Tiotropium', dose: '18mcg', frequency: 'Once daily', since: daysAgo(500) }],
    labResults: [{ name: 'FEV1', value: 71, unit: '%pred', normal: '>80', flag: 'L' }],
    outreach: [],
    notes: [],
  }),
  enrich({
    id: 'PT-007',
    name: 'Tom Nguyen',
    age: 66,
    gender: 'M',
    condition: 'Type 2 Diabetes + HF',
    stage: 'Eligible',
    eligibilityScore: 55,
    aiConfidence: 62,
    uploadedAt: daysAgo(6),
    tags: ['Complex case'],
    reasons: [
      { feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 66 within range' },
      { feature: 'Primary condition match', passed: true, weight: 30, detail: 'T2DM confirmed' },
      { feature: 'Cardiovascular safety', passed: false, weight: 15, detail: 'Heart failure NYHA class II — borderline' },
      { feature: 'HbA1c ≥ 7.5%', passed: true, weight: 20, detail: 'HbA1c = 8.9%' },
    ],
    riskFlags: [{ type: 'Cardiac concern', level: 'medium', note: 'Heart failure needs cardiology clearance' }],
    history: [{ date: daysAgo(900), event: 'T2DM + HF diagnosis', detail: 'NYHA Class II heart failure', type: 'diagnosis' }],
    medications: [
      { name: 'Metformin', dose: '500mg', frequency: 'Once daily', since: daysAgo(900) },
      { name: 'Furosemide', dose: '40mg', frequency: 'Once daily', since: daysAgo(900) },
    ],
    labResults: [
      { name: 'HbA1c', value: 8.9, unit: '%', normal: '4.0–5.6', flag: 'H' },
      { name: 'eGFR', value: 48, unit: 'mL/min', normal: '>60', flag: 'L' },
      { name: 'BNP', value: 340, unit: 'pg/mL', normal: '<100', flag: 'H' },
    ],
    outreach: [],
    notes: [],
  }),
]

// ═══════════════════════════════════════════════════════════════════
// ATOMS
// ═══════════════════════════════════════════════════════════════════
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      ...flexCenter, width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, ${C.navy}, ${C.blue}, ${C.teal})`,
      color: '#fff', fontWeight: 700, fontSize: size * 0.35,
    }}>{initials}</div>
  )
}

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const fill = circ * (1 - score / 100)
  const stroke = getScoreColor(score)
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.5s' }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.26} fontWeight={700} fill={stroke}>{score}</text>
    </svg>
  )
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: '#E2E8F0', overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 3, background: color, width: `${Math.min(100, (value / max) * 100)}%`, transition: 'width 0.5s' }} />
    </div>
  )
}

function RiskPill({ flag }: { flag: RiskFlag }) {
  const m = RISK_META[flag.level]
  return <span style={{ borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 700, background: m.bg, color: m.text, border: `1px solid ${m.border}` }}>⚠ {flag.type}</span>
}

function StageBadge({ stage }: { stage: RecruitStage }) {
  const m = STAGE_META[stage]
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>{m.icon} {stage}</span>
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const bg = confidence >= 80 ? '#F5F3FF' : confidence >= 60 ? '#FFFBEB' : '#FEF2F2'
  const color = confidence >= 80 ? C.purple : confidence >= 60 ? '#B45309' : '#B91C1C'
  return <span style={{ borderRadius: 8, background: bg, color, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{confidence}% conf.</span>
}

function RiskLevelBadge({ level }: { level: RiskLevel }) {
  const m = RISK_META[level]
  return <span style={{ borderRadius: 8, border: `1px solid ${m.border}`, background: m.bg, color: m.text, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}>{level} risk</span>
}

function Button({ variant = 'primary', children, loading, disabled, onClick, style: extra }: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'sm'; children: ReactNode; loading?: boolean; disabled?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; style?: CSSProperties
}) {
  const base: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, fontWeight: 600, border: 'none', cursor: disabled || loading ? 'not-allowed' : 'pointer', opacity: disabled || loading ? 0.5 : 1, fontFamily: 'inherit' }
  const variants: Record<string, CSSProperties> = {
    primary: { background: `linear-gradient(135deg, ${C.navy}, ${C.blue}, ${C.teal})`, color: '#fff', padding: '10px 20px', fontSize: 14, boxShadow: C.cardShadow },
    secondary: { background: C.white, color: C.blue, border: `2px solid ${C.blue}`, padding: '8px 18px', fontSize: 14 },
    ghost: { background: 'transparent', color: C.muted, padding: '8px 16px', fontSize: 14 },
    danger: { background: '#DC2626', color: '#fff', padding: '10px 20px', fontSize: 14 },
    sm: { background: C.blueLight, color: '#1E40AF', border: `1px solid #BFDBFE`, padding: '4px 12px', fontSize: 11, fontWeight: 700 },
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading} style={{ ...base, ...variants[variant], ...extra }}>
      {loading && <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
      {children}
    </button>
  )
}

function Card({ children, style: extra, onClick, onKeyDown, role, tabIndex, 'aria-pressed': ariaPressed, 'aria-label': ariaLabel }: {
  children: ReactNode
  style?: CSSProperties
  onClick?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  role?: string
  tabIndex?: number
  'aria-pressed'?: boolean
  'aria-label'?: string
}) {
  return (
    <div
      style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: C.white, boxShadow: C.cardShadow, ...extra }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={role}
      tabIndex={tabIndex}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}
function CardHeader({ children, style: extra }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 20px', ...extra }}>{children}</div>
}
function CardBody({ children, style: extra, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
  return <div style={{ padding: 20, ...extra }} onClick={onClick}>{children}</div>
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="animate-fade-in" style={{ position: 'fixed', inset: 0, zIndex: 300, ...flexCenter, background: 'rgba(15,23,42,0.5)', padding: 16 }} onClick={onClose}>
      <div style={{ maxHeight: '90vh', width: '100%', maxWidth: wide ? 768 : 512, overflowY: 'auto', borderRadius: 16, background: C.white, boxShadow: C.elevated }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...flexBetween, padding: '16px 24px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.white, borderRadius: '16px 16px 0 0' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: C.slate, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  )
}

function EmptyState({ icon = '📭', title, description }: { icon?: string; title: string; description?: string }) {
  return (
    <div style={{ ...flexCenter, flexDirection: 'column', padding: 32, color: C.muted, textAlign: 'center' }}>
      <span style={{ fontSize: 32, marginBottom: 8 }}>{icon}</span>
      <p style={{ margin: 0, fontWeight: 700, color: C.text }}>{title}</p>
      {description && <p style={{ margin: '4px 0 0', fontSize: 13 }}>{description}</p>}
    </div>
  )
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div style={{ ...flexCenter, flexDirection: 'column', padding: 48, gap: 16 }}>
      <div style={{ width: 48, height: 48, border: `4px solid ${C.border}`, borderTopColor: C.blue, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: C.muted, fontWeight: 600 }}>{message}</p>
    </div>
  )
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const styles: Record<Toast['type'], CSSProperties> = {
    ok: { background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857' },
    warn: { background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309' },
    err: { background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' },
  }
  return (
    <div style={{ position: 'fixed', right: 16, top: 16, zIndex: 600, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDone={onDismiss} style={styles[t.type]} />
      ))}
    </div>
  )
}

function ToastItem({ t, onDone, style }: { t: Toast; onDone: (id: number) => void; style: CSSProperties }) {
  useEffect(() => { const tm = setTimeout(() => onDone(t.id), 3200); return () => clearTimeout(tm) }, [t, onDone])
  return (
    <div className="animate-slide-in" style={{ ...flex, alignItems: 'center', gap: 8, borderRadius: 12, padding: '12px 16px', fontSize: 14, fontWeight: 600, boxShadow: C.elevated, pointerEvents: 'auto', ...style }}>
      {t.type === 'ok' ? '✓' : t.type === 'warn' ? '⚠' : '✕'} {t.msg}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI EXPLAINABILITY
// ═══════════════════════════════════════════════════════════════════
function AIExplainPanel({ patient, trial, docCount = 0, compact = false }: { patient: Patient; trial: Trial; docCount?: number; compact?: boolean }) {
  const passed = patient.reasons.filter((r) => r.passed)
  const failed = patient.reasons.filter((r) => !r.passed)
  const warnings = getMissingDataWarnings(patient, trial)
  const protocol = getProtocolChecks(patient, trial)
  const crit = trial.protocolCriteria
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16 }}>
      {crit && (
        <div style={{ borderRadius: 10, border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '10px 12px', fontSize: 11, color: '#1E40AF' }}>
          <strong>📁 Protocol source of truth</strong> — criteria from <em>{crit.sourceDocTitle}</em>
          {docCount > 0 && <span> · {docCount} reference doc{docCount !== 1 ? 's' : ''} on file</span>}
        </div>
      )}
      {crit && !compact && (
        <section>
          <h4 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Parsed protocol criteria</h4>
          <p style={{ margin: '0 0 4px', fontSize: 11, color: C.text }}><strong>Inclusion:</strong> {crit.inclusion.slice(0, 2).join(' · ')}</p>
          <p style={{ margin: 0, fontSize: 11, color: '#B91C1C' }}><strong>Exclusion:</strong> {crit.exclusion.slice(0, 2).join(' · ')}</p>
        </section>
      )}
      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.blue }}>Protocol compatibility — {trial.title}</h4>
        {protocol.map((c, i) => (
          <div key={i} style={{ ...flexBetween, borderRadius: 8, border: `1px solid ${c.passed ? '#BFDBFE' : '#FECACA'}`, background: c.passed ? '#EFF6FF' : '#FEF2F2', padding: '8px 12px', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: c.passed ? '#1D4ED8' : '#B91C1C' }}>{c.passed ? '✓' : '✗'} {c.label}</span>
            <span style={{ fontSize: 10, color: C.muted, maxWidth: '55%', textAlign: 'right' }}>{c.detail}</span>
          </div>
        ))}
      </section>
      {warnings.length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#B45309' }}>⚠ Missing data / alerts ({warnings.length})</h4>
          {warnings.map((w, i) => (
            <div key={i} style={{ borderRadius: 8, border: '1px solid #FDE68A', background: '#FFFBEB', padding: '8px 12px', marginBottom: 6, fontSize: 11, color: '#92400E' }}>{w}</div>
          ))}
        </section>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ borderRadius: 12, background: C.blueLight, padding: 16, textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Eligibility Score</p>
          <div style={flexCenter}><ScoreRing score={patient.eligibilityScore} size={compact ? 48 : 64} /></div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted }}>AI evaluated {patient.reasons.length} criteria</p>
        </div>
        <div style={{ borderRadius: 12, background: '#F5F3FF', padding: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>AI Confidence</p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: C.purple }}>{patient.aiConfidence}%</p>
          <ProgressBar value={patient.aiConfidence} max={100} color={C.purple} />
        </div>
      </div>
      <section>
        <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#047857' }}>✓ Matching criteria ({passed.length})</h4>
        {passed.map((r, i) => (
          <div key={i} style={{ borderRadius: 8, border: '1px solid #A7F3D0', background: '#ECFDF5', padding: '8px 12px', marginBottom: 8 }}>
            <div style={flexBetween}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#047857' }}>{r.feature}</span>
              <span style={{ borderRadius: 6, background: '#059669', color: '#fff', padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>+{r.weight}pts</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: C.muted }}>{r.detail}</p>
          </div>
        ))}
      </section>
      {failed.length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#B91C1C' }}>✗ Exclusion / failed ({failed.length})</h4>
          {failed.map((r, i) => (
            <div key={i} style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '8px 12px', marginBottom: 8 }}>
              <div style={flexBetween}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#B91C1C' }}>{r.feature}</span>
                <span style={{ borderRadius: 6, background: '#DC2626', color: '#fff', padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>−{r.weight}pts</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: C.muted }}>{r.detail}</p>
            </div>
          ))}
        </section>
      )}
      {patient.riskFlags.length > 0 && (
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#B45309' }}>⚠ Risk indicators</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{patient.riskFlags.map((f, i) => <RiskPill key={i} flag={f} />)}</div>
        </section>
      )}
    </div>
  )
}

function AIReasonPreview({ patient, max = 3 }: { patient: Patient; max?: number }) {
  return (
    <div>
      {patient.reasons.slice(0, max).map((r, i) => (
        <div key={i} style={{ ...flex, gap: 8, fontSize: 12, marginBottom: 2 }}>
          <span style={{ color: r.passed ? '#059669' : '#DC2626' }}>{r.passed ? '✓' : '✗'}</span>
          <span style={{ color: r.passed ? C.text : '#B91C1C' }}>{r.feature}</span>
        </div>
      ))}
      {patient.reasons.length > max && <p style={{ margin: 0, fontSize: 10, color: C.slate }}>+{patient.reasons.length - max} more criteria</p>}
    </div>
  )
}

function OutreachModal({ patient, onClose, onSend }: { patient: Patient; onClose: () => void; onSend: (rec: OutreachRecord) => void }) {
  const [channel, setChannel] = useState<'email' | 'sms' | 'call'>('email')
  const [templateId, setTemplateId] = useState(MSG_TEMPLATES[0].id)
  const [note, setNote] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const tmpl = MSG_TEMPLATES.find((t) => t.id === templateId)
  const preview = tmpl?.body.replace('{name}', patient.name.split(' ')[0]) ?? ''
  const inputStyle: CSSProperties = { width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit' }
  return (
    <Modal title={`Outreach — ${patient.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Channel</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {(['email', 'sms', 'call'] as const).map((ch) => (
              <button key={ch} type="button" onClick={() => setChannel(ch)} style={{
                borderRadius: 12, border: `2px solid ${channel === ch ? C.blue : C.border}`, padding: '10px 0', fontSize: 12, fontWeight: 700,
                background: channel === ch ? C.blueLight : C.white, color: channel === ch ? '#1E40AF' : C.muted, cursor: 'pointer',
              }}>{ch === 'email' ? '📧 Email' : ch === 'sms' ? '📱 SMS' : '📞 Call'}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Template</label>
          <select style={inputStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {MSG_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ borderRadius: 12, background: '#F8FAFC', padding: 16, fontSize: 14, fontStyle: 'italic', color: C.muted }}>{preview}</div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Follow-up date (optional)</label>
          <input type="date" style={inputStyle} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Internal note</label>
          <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} placeholder="Optional internal note…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div style={{ ...flex, justifyContent: 'flex-end', gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSend({ id: 'o' + Date.now(), channel, template: tmpl?.name ?? 'Custom', sentAt: new Date().toISOString().slice(0, 10), status: channel === 'email' ? 'sent' : 'delivered', note: note || undefined, followUpDate: followUpDate || undefined })}>Send {channel}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PATIENT DETAIL
// ═══════════════════════════════════════════════════════════════════
type DetailTab = 'overview' | 'medical' | 'ai' | 'outreach' | 'notes' | 'activity'

function PatientDetailView({ patient, trial, session, onBack, stageChange, addNote, addOutreach, toggleFlag, docCount = 0 }: {
  patient: Patient; trial: Trial; session: DemoUser; onBack: () => void
  stageChange: (pid: string, stage: RecruitStage) => void; addNote: (pid: string, note: string) => void
  addOutreach: (pid: string, rec: OutreachRecord) => void; toggleFlag: (pid: string) => void; docCount?: number
}) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [noteText, setNoteText] = useState('')
  const [showOutreach, setShowOutreach] = useState(false)
  const role = session.role
  const TABS: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'medical', label: 'Medical Profile' },
    { id: 'ai', label: '🤖 AI Explainability' }, { id: 'outreach', label: 'Outreach' },
    { id: 'notes', label: 'Recruiter Notes' }, { id: 'activity', label: 'Activity Log' },
  ]
  return (
    <div style={{ ...flexCol, height: '100vh', overflow: 'hidden', background: C.bg }}>
      {showOutreach && <OutreachModal patient={patient} onClose={() => setShowOutreach(false)} onSend={(rec) => { addOutreach(patient.id, rec); setShowOutreach(false) }} />}
      <header style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.white, padding: '16px 24px' }}>
        <div style={{ ...flex, flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Button variant="secondary" onClick={onBack}>← Back</Button>
          <Avatar name={patient.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{patient.name} {patient.flagged && '🚩'}</h1>
            <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{patient.id} · Age {patient.age} · {patient.gender} · {patient.diagnosis}</p>
          </div>
          <StageBadge stage={patient.stage} />
          <ScoreRing score={patient.eligibilityScore} size={48} />
          {canMoveStage(role) && (
            <select style={{ borderRadius: 12, border: `2px solid ${C.border}`, padding: '8px 12px', fontSize: 14 }} value={patient.stage} onChange={(e) => stageChange(patient.id, e.target.value as RecruitStage)}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {canManageOutreach(role) && <>
            <Button variant="secondary" onClick={() => setShowOutreach(true)}>📧 Email</Button>
            <Button variant="secondary" onClick={() => setShowOutreach(true)}>📱 SMS</Button>
          </>}
          <Button variant={patient.flagged ? 'danger' : 'secondary'} onClick={() => toggleFlag(patient.id)}>{patient.flagged ? 'Unflag' : 'Flag Patient'}</Button>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, borderBottom: `1px solid ${C.border}`, background: C.white, padding: '12px 24px' }}>
        {[{ label: 'Eligibility', value: `${patient.eligibilityScore}/100`, color: '#047857' }, { label: 'AI Confidence', value: `${patient.aiConfidence}%`, color: C.purple },
          { label: 'Risk Flags', value: patient.riskFlags.length || 'None', color: '#B45309' }, { label: 'Outreach', value: patient.outreach.length, color: C.blue }].map((k) => (
          <Card key={k.label} style={{ boxShadow: 'none' }}><CardBody style={{ padding: 12 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>{k.label}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</p>
          </CardBody></Card>
        ))}
      </div>
      {patient.riskFlags.length > 0 && (
        <div style={{ ...flex, flexWrap: 'wrap', gap: 8, alignItems: 'center', borderBottom: '1px solid #FDE68A', background: '#FFFBEB', padding: '8px 24px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#B45309' }}>⚠ Risk flags:</span>
          {patient.riskFlags.map((f, i) => <RiskPill key={i} flag={f} />)}
        </div>
      )}
      <div style={{ ...flex, flexShrink: 0, overflowX: 'auto', borderBottom: `1px solid ${C.border}`, background: C.white, padding: '0 24px' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
            border: 'none', borderBottom: tab === t.id ? `2px solid ${C.blue}` : '2px solid transparent', background: 'none',
            padding: '12px 16px', fontSize: 14, fontWeight: tab === t.id ? 600 : 500, color: tab === t.id ? C.blue : C.muted, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <Card><CardBody>
                <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>Patient Overview</h3>
                {[['Diagnosis', patient.diagnosis], ['Condition', patient.condition], ['Age', `${patient.age} years`], ['Stage', patient.stage], ['Risk level', patient.riskLevel], ['Added', patient.uploadedAt], ['Last contact', patient.lastContact ?? 'Not yet']].map(([k, v]) => (
                  <div key={k as string} style={{ ...flexBetween, borderBottom: '1px solid #F8FAFC', padding: '8px 0', fontSize: 14 }}>
                    <span style={{ fontWeight: 600, color: C.muted }}>{k}</span><span>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {patient.tags.map((tag) => <span key={tag} style={{ borderRadius: 999, background: C.blueLight, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#1E40AF' }}>{tag}</span>)}
                </div>
              </CardBody></Card>
              <Card><CardBody>
                <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>AI Match vs {trial.title}</h3>
                <div style={flexCenter}><ScoreRing score={patient.eligibilityScore} size={80} /></div>
                <p style={{ textAlign: 'center', fontSize: 14, color: C.muted }}>Confidence: <strong style={{ color: C.purple }}>{patient.aiConfidence}%</strong></p>
              </CardBody></Card>
            </div>
          )}
          {tab === 'medical' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Card><CardBody>
                <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>🔬 Lab Results</h3>
                <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}`, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: C.muted }}>
                    {['Test', 'Value', 'Unit', 'Normal', 'Flag'].map((h) => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{patient.labResults.map((lab, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F8FAFC' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{lab.name}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: lab.flag === 'H' ? '#DC2626' : lab.flag === 'L' ? '#D97706' : C.text }}>{lab.value}</td>
                      <td style={{ padding: '8px 12px', color: C.muted }}>{lab.unit}</td>
                      <td style={{ padding: '8px 12px', color: C.muted }}>{lab.normal}</td>
                      <td style={{ padding: '8px 12px' }}>{lab.flag && <strong>{lab.flag}</strong>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </CardBody></Card>
              <Card><CardBody>
                <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>💊 Medications</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {patient.medications.map((med, i) => (
                    <div key={i} style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: '#F8FAFC', padding: 12 }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>{med.name}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{med.dose} · {med.frequency}</p>
                    </div>
                  ))}
                </div>
              </CardBody></Card>
              <Card><CardBody>
                <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>📋 Medical History</h3>
                {patient.history.map((h, i) => (
                  <div key={i} style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: '#F8FAFC', padding: 12, marginBottom: 12, borderLeft: `3px solid ${C.blue}` }}>
                    <div style={flexBetween}><span style={{ fontWeight: 600, fontSize: 14 }}>{h.event}</span><span style={{ fontSize: 12, color: C.slate }}>{h.date}</span></div>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{h.detail}</p>
                  </div>
                ))}
              </CardBody></Card>
            </div>
          )}
          {tab === 'ai' && <AIExplainPanel patient={patient} trial={trial} docCount={docCount} />}
          {tab === 'outreach' && (
            <div>
              {canManageOutreach(role) && <Button style={{ marginBottom: 16 }} onClick={() => setShowOutreach(true)}>📤 Send outreach</Button>}
              {patient.outreach.length === 0 ? <EmptyState title="No outreach sent yet" /> : [...patient.outreach].reverse().map((rec) => (
                <Card key={rec.id} style={{ marginBottom: 12 }}><CardBody style={{ ...flex, alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{rec.channel === 'email' ? '📧' : rec.channel === 'sms' ? '📱' : '📞'}</span>
                  <div style={{ flex: 1 }}><p style={{ margin: 0, fontWeight: 600 }}>{rec.template}</p><p style={{ margin: 0, fontSize: 12, color: C.muted }}>{rec.channel.toUpperCase()} · {rec.sentAt}</p></div>
                  <span style={{ borderRadius: 999, background: C.blueLight, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: '#1E40AF' }}>{OUTREACH_STATUS_LABELS[rec.status]}</span>
                </CardBody></Card>
              ))}
            </div>
          )}
          {tab === 'notes' && (
            <div>
              <Card style={{ marginBottom: 16 }}><CardBody>
                <textarea style={{ width: '100%', minHeight: 80, borderRadius: 12, border: `2px solid ${C.border}`, padding: 12, fontSize: 14, fontFamily: 'inherit' }} placeholder="Add a recruiter note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                <div style={{ marginTop: 8, textAlign: 'right' }}><Button disabled={!noteText.trim()} onClick={() => { addNote(patient.id, noteText.trim()); setNoteText('') }}>Save note</Button></div>
              </CardBody></Card>
              {[...patient.notes].reverse().map((note, i) => <Card key={i} style={{ marginBottom: 8 }}><CardBody><p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{note}</p></CardBody></Card>)}
            </div>
          )}
          {tab === 'activity' && (
            patient.activityLog.length === 0 ? <EmptyState title="No activity yet" /> :
            patient.activityLog.map((a) => (
              <div key={a.id} style={{ ...flex, gap: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: C.white, padding: 12, marginBottom: 8, fontSize: 14 }}>
                <span style={{ fontSize: 18 }}>{a.type === 'ai' ? '🤖' : a.type === 'outreach' ? '📤' : a.type === 'stage' ? '🔄' : '📝'}</span>
                <div><p style={{ margin: 0, fontWeight: 500 }}>{a.message}</p><p style={{ margin: 0, fontSize: 12, color: C.slate }}>{new Date(a.timestamp).toLocaleString()}</p></div>
              </div>
            ))
          )}
        </div>
        <aside className="scrollbar-thin" style={{ width: 300, flexShrink: 0, overflowY: 'auto', borderLeft: `1px solid ${C.border}`, background: C.white, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>AI Explainability Panel</h3>
          <AIExplainPanel patient={patient} trial={trial} docCount={docCount} compact />
        </aside>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// KANBAN
// ═══════════════════════════════════════════════════════════════════
function KanbanView({ patients, role, stageChange, setDetailPatient, addOutreach }: {
  patients: Patient[]; role: Role; stageChange: (pid: string, stage: RecruitStage) => void
  setDetailPatient: (p: Patient) => void; addOutreach: (pid: string, rec: OutreachRecord) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<RecruitStage | null>(null)
  const [stageFilter, setStageFilter] = useState<RecruitStage | 'all'>('all')
  const [cardSearch, setCardSearch] = useState('')
  const [outreachPatient, setOutreachPatient] = useState<Patient | null>(null)
  const filtered = patients.filter((p) =>
    (stageFilter === 'all' || p.stage === stageFilter)
    && (!cardSearch || p.name.toLowerCase().includes(cardSearch.toLowerCase()) || p.condition.toLowerCase().includes(cardSearch.toLowerCase())),
  )
  const selStyle: CSSProperties = { borderRadius: 12, border: `2px solid ${C.border}`, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit' }
  return (
    <div style={{ ...flexCol, height: '100%', overflow: 'hidden', background: C.bg }}>
      {outreachPatient && <OutreachModal patient={outreachPatient} onClose={() => setOutreachPatient(null)} onSend={(rec) => { addOutreach(outreachPatient.id, rec); setOutreachPatient(null) }} />}
      <div style={{ ...flex, flexWrap: 'wrap', gap: 12, alignItems: 'center', flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.white, padding: '12px 24px' }}>
        <select style={selStyle} value={stageFilter} onChange={(e) => setStageFilter(e.target.value as RecruitStage | 'all')}>
          <option value="all">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="search" placeholder="Search cards…" value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} style={{ ...selStyle, width: 200 }} />
        <span style={{ fontSize: 14, color: C.muted }}>{patients.length} patients</span>
      </div>
      <div className="scrollbar-thin" style={{ display: 'flex', flex: 1, gap: 12, overflowX: 'auto', padding: 16 }}>
        {STAGES.map((stage) => {
          const m = STAGE_META[stage]
          const stagePts = filtered.filter((p) => p.stage === stage)
          const isOver = dragOver === stage
          return (
            <div key={stage} style={{ width: 256, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(stage) }} onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); if (dragging && canMoveStage(role)) stageChange(dragging, stage); setDragging(null); setDragOver(null) }}>
              <div style={{ borderRadius: 12, border: `2px solid ${isOver ? m.border : 'transparent'}`, background: m.bg, padding: '10px 12px' }}>
                <div style={flexBetween}><span style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.icon} {stage}</span>
                  <span style={{ borderRadius: 999, background: m.color, color: '#fff', padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{stagePts.length}</span></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 280, overflowY: 'auto', borderRadius: 12, padding: 4, border: isOver ? `2px dashed ${m.border}` : '2px dashed transparent', background: isOver ? m.bg : 'transparent' }}>
                {stagePts.length === 0 && !isOver && <EmptyState icon={m.icon} title="No patients" description="Drag patients here" />}
                {stagePts.map((p) => (
                  <div key={p.id} draggable={canMoveStage(role)} onDragStart={() => setDragging(p.id)} onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: C.white, padding: 12, boxShadow: C.cardShadow, cursor: canMoveStage(role) ? 'grab' : 'default', opacity: dragging === p.id ? 0.5 : 1 }}>
                    <div style={{ ...flex, gap: 8, marginBottom: 8 }}><Avatar name={p.name} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                        <p style={{ margin: 0, fontSize: 10, color: C.slate }}>Age {p.age}</p></div>
                      <ScoreRing score={p.eligibilityScore} size={32} /></div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.diagnosis}</p>
                    <div style={{ ...flex, flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      <ConfidenceBadge confidence={p.aiConfidence} />
                      <RiskLevelBadge level={p.riskLevel} />
                      {p.riskFlags.slice(0, 1).map((f, i) => <RiskPill key={i} flag={f} />)}
                    </div>
                    <AIReasonPreview patient={p} max={2} />
                    <div style={{ ...flex, gap: 4, marginTop: 8 }}>
                      <Button variant="sm" onClick={() => setDetailPatient(p)}>View</Button>
                      {canManageOutreach(role) && <Button variant="sm" onClick={() => setOutreachPatient(p)}>📤</Button>}
                    </div>
                  </div>
                ))}
                {isOver && <div style={{ borderRadius: 12, border: `2px dashed ${m.border}`, padding: 24, textAlign: 'center', fontSize: 12, fontWeight: 600, color: m.color }}>Drop here</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ADD PATIENTS
// ═══════════════════════════════════════════════════════════════════
function AddPatientsModal({
  trial, allPatients, onClose, onImport, toast, initialTab = 'single',
}: {
  trial: Trial
  allPatients: Patient[]
  onClose: () => void
  onImport: (patients: Patient[]) => void
  toast: (msg: string, type?: Toast['type']) => void
  initialTab?: 'single' | 'bulk'
}) {
  const [tab, setTab] = useState<'single' | 'bulk'>(initialTab)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PatientImportRow[]>([])
  const [parseSource, setParseSource] = useState('')
  const [selectedPreview, setSelectedPreview] = useState<Set<number>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [form, setForm] = useState({
    name: '', age: '', gender: 'Other' as 'M' | 'F' | 'Other', condition: trial.condition, diagnosis: '', stage: 'Identified' as RecruitStage, notes: '',
  })

  const inp: CSSProperties = { width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.muted }
  const selStyle: CSSProperties = { ...inp, cursor: 'pointer' }

  const resetBulk = () => {
    setPreviewRows([])
    setParseSource('')
    setParseError(null)
    setSelectedPreview(new Set())
  }

  useEffect(() => {
    setTab(initialTab)
    setForm((f) => ({ ...f, condition: trial.condition }))
    resetBulk()
  }, [initialTab, trial.condition]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (file: File) => {
    setParseError(null)
    setParsing(true)
    try {
      const { rows, source } = await parseBulkPatientFile(file, trial)
      if (rows.length === 0) {
        setParseError('No patients found in file. Check column headers: name, age, gender, condition.')
        resetBulk()
      } else {
        setPreviewRows(rows)
        setParseSource(source)
        setSelectedPreview(new Set(rows.map((_, i) => i)))
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
      resetBulk()
    }
    setParsing(false)
  }

  const importSingle = () => {
    const age = parseInt(form.age, 10)
    if (!form.name.trim() || Number.isNaN(age)) {
      toast('Name and age are required', 'warn')
      return
    }
    const id = nextPatientId(allPatients)
    onImport([buildPatientFromImport({
      name: form.name,
      age,
      gender: form.gender,
      condition: form.condition.trim() || trial.condition,
      diagnosis: form.diagnosis.trim() || undefined,
      stage: form.stage,
      notes: form.notes.trim() || undefined,
    }, trial.id, id)])
    onClose()
  }

  const importBulk = () => {
    const toImport = previewRows.filter((_, i) => selectedPreview.has(i))
    if (toImport.length === 0) {
      toast('Select at least one patient to import', 'warn')
      return
    }
    let ids = [...allPatients]
    const built = toImport.map((row) => {
      const id = nextPatientId(ids)
      const p = buildPatientFromImport(row, trial.id, id)
      ids = [...ids, p]
      return p
    })
    onImport(built)
    onClose()
  }

  const togglePreview = (i: number) => {
    setSelectedPreview((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const accept = '.csv,.tsv,.json,.pdf,.xlsx,.xls,.txt'

  return (
    <Modal title="Add patients" onClose={onClose} wide>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: C.muted }}>
        Adding to <strong>{trial.title}</strong> ({trial.protocolId}). New patients start as <strong>Identified</strong> with score pending AI run.
      </p>
      <div style={{ ...flex, gap: 8, marginBottom: 20 }}>
        {(['single', 'bulk'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); resetBulk() }}
            style={{
              borderRadius: 10, border: `2px solid ${tab === t ? C.blue : C.border}`, padding: '8px 16px',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: tab === t ? C.blueLight : C.white, color: tab === t ? C.blue : C.muted,
            }}
          >
            {t === 'single' ? '➕ Single patient' : '📤 Bulk upload'}
          </button>
        ))}
      </div>

      {tab === 'single' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Full name *</label>
            <input style={inp} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" />
          </div>
          <div>
            <label style={lbl}>Age *</label>
            <input style={inp} type="number" min={18} max={99} value={form.age} onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Gender</label>
            <select style={selStyle} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as 'M' | 'F' | 'Other' }))}>
              <option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Condition *</label>
            <input style={inp} value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Diagnosis (optional)</label>
            <input style={inp} value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} placeholder="Same as condition if empty" />
          </div>
          <div>
            <label style={lbl}>Initial stage</label>
            <select style={selStyle} value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as RecruitStage }))}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1', ...flex, justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={importSingle}>Add patient</Button>
          </div>
        </div>
      )}

      {tab === 'bulk' && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            style={{
              borderRadius: 14, border: `2px dashed ${dragOver ? C.blue : C.border}`, background: dragOver ? C.blueLight : '#F8FAFC',
              padding: 28, textAlign: 'center', marginBottom: 16,
            }}
          >
            {parsing ? (
              <LoadingOverlay message="Extracting patient data from file…" />
            ) : (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 28 }}>📁</p>
                <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Drop file here or browse</p>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted }}>Excel (.xlsx, .xls), CSV, JSON, PDF, TXT</p>
                <label style={{ cursor: 'pointer' }}>
                  <span style={{ ...flexCenter, display: 'inline-flex', borderRadius: 10, background: C.blue, color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>Choose file</span>
                  <input type="file" accept={accept} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
                </label>
              </>
            )}
          </div>

          <div style={{ ...flex, gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <Button variant="secondary" onClick={() => {
              const blob = new Blob([BULK_TEMPLATE_CSV], { type: 'text/csv' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `patient-import-template-${trial.protocolId}.csv`
              a.click()
              toast('Template downloaded')
            }}>Download CSV template</Button>
            <span style={{ fontSize: 11, color: C.slate, alignSelf: 'center' }}>Required columns: name, age · Optional: gender, condition, stage, notes</span>
          </div>

          {parseError && (
            <div style={{ borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', padding: 12, marginBottom: 12, fontSize: 13, color: '#B91C1C' }}>{parseError}</div>
          )}

          {previewRows.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <CardHeader style={flexBetween}>
                <span style={{ fontWeight: 700 }}>Preview — {selectedPreview.size} of {previewRows.length} selected</span>
                <span style={{ fontSize: 11, color: C.muted }}>Parsed via {parseSource}</span>
              </CardHeader>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                      <th style={{ padding: 8, width: 36 }}><input type="checkbox" checked={selectedPreview.size === previewRows.length} onChange={(e) => setSelectedPreview(e.target.checked ? new Set(previewRows.map((_, i) => i)) : new Set())} /></th>
                      {['Name', 'Age', 'Gender', 'Condition', 'Stage'].map((h) => <th key={h} style={{ padding: 8 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: 8 }}><input type="checkbox" checked={selectedPreview.has(i)} onChange={() => togglePreview(i)} /></td>
                        <td style={{ padding: 8, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: 8 }}>{r.age}</td>
                        <td style={{ padding: 8 }}>{r.gender}</td>
                        <td style={{ padding: 8 }}>{r.condition}</td>
                        <td style={{ padding: 8 }}>{r.stage ?? 'Identified'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div style={{ ...flex, justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={importBulk} disabled={previewRows.length === 0}>Import {selectedPreview.size || ''} patient{selectedPreview.size !== 1 ? 's' : ''}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PATIENT LIST
// ═══════════════════════════════════════════════════════════════════
function PatientListView({ patients, trial, allPatients, setDetailPatient, onAddPatients, canAdd, toast }: {
  patients: Patient[]
  trial: Trial
  allPatients: Patient[]
  setDetailPatient: (p: Patient) => void
  onAddPatients: (patients: Patient[]) => void
  canAdd: boolean
  toast: (msg: string, type?: Toast['type']) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [filterStage, setFilterStage] = useState<RecruitStage | 'all'>('all')
  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'stage'>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const sorted = useMemo(() => {
    let pts = patients.filter((p) => (filterStage === 'all' || p.stage === filterStage) && (filterRisk === 'all' || p.riskLevel === filterRisk) && (!flaggedOnly || p.flagged))
    return [...pts].sort((a, b) => {
      if (sortBy === 'score') return sortDir === 'desc' ? b.eligibilityScore - a.eligibilityScore : a.eligibilityScore - b.eligibilityScore
      if (sortBy === 'name') return sortDir === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
      return sortDir === 'desc' ? STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) : STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)
    })
  }, [patients, filterStage, filterRisk, flaggedOnly, sortBy, sortDir])
  const selStyle: CSSProperties = { borderRadius: 12, border: `2px solid ${C.border}`, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit' }
  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      {showAdd && (
        <AddPatientsModal
          trial={trial}
          allPatients={allPatients}
          onClose={() => setShowAdd(false)}
          onImport={onAddPatients}
          toast={toast}
        />
      )}
      <div style={{ ...flexBetween, flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ ...flex, flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <select style={selStyle} value={filterStage} onChange={(e) => setFilterStage(e.target.value as RecruitStage | 'all')}>
          <option value="all">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={selStyle} value={filterRisk} onChange={(e) => setFilterRisk(e.target.value as RiskLevel | 'all')}>
          <option value="all">All risk levels</option>
          {(['low', 'medium', 'high'] as RiskLevel[]).map((r) => <option key={r} value={r}>{r} risk</option>)}
        </select>
        <label style={{ ...flex, alignItems: 'center', gap: 6, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
        </label>
        <Button variant="sm" onClick={() => { setSortBy('score'); setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')) }}>Sort by score {sortBy === 'score' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</Button>
        <span style={{ fontSize: 14, color: C.muted }}>{sorted.length} patients</span>
        </div>
        {canAdd && (
          <Button onClick={() => setShowAdd(true)}>+ Add patient</Button>
        )}
      </div>
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            title="No patients found"
            description={canAdd ? 'Add a patient manually or import a CSV, Excel, JSON, or PDF file.' : 'Try adjusting filters or switch the active trial.'}
          />
          {canAdd && (
            <div style={{ ...flex, justifyContent: 'center', paddingBottom: 24 }}>
              <Button onClick={() => setShowAdd(true)}>+ Add patient</Button>
            </div>
          )}
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 800, fontSize: 14, borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}`, background: '#F8FAFC', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>
                {['Patient', 'Diagnosis', 'Age', 'Score', 'Confidence', 'Stage', 'Risk', 'Actions'].map((h) => <th key={h} style={{ padding: '12px 16px' }}>{h}</th>)}
              </tr></thead>
              <tbody>{sorted.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F8FAFC' }}>
                  <td style={{ padding: '12px 16px' }}><div style={{ ...flex, gap: 8 }}><Avatar name={p.name} size={32} />
                    <div><p style={{ margin: 0, fontWeight: 600 }}>{p.name} {p.flagged && '🚩'}</p><p style={{ margin: 0, fontSize: 10, color: C.slate }}>{p.id}</p></div></div></td>
                  <td style={{ padding: '12px 16px', color: C.muted }}>{p.diagnosis}</td>
                  <td style={{ padding: '12px 16px' }}>{p.age}</td>
                  <td style={{ padding: '12px 16px' }}><ScoreRing score={p.eligibilityScore} size={36} /></td>
                  <td style={{ padding: '12px 16px' }}><p style={{ margin: 0, fontWeight: 700, color: C.purple }}>{p.aiConfidence}%</p><ProgressBar value={p.aiConfidence} max={100} color={C.purple} /></td>
                  <td style={{ padding: '12px 16px' }}><StageBadge stage={p.stage} /></td>
                  <td style={{ padding: '12px 16px' }}>{p.riskFlags.length === 0 ? <span style={{ fontSize: 12, color: C.slate }}>None</span> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{p.riskFlags.map((f, i) => <RiskPill key={i} flag={f} />)}</div>}</td>
                  <td style={{ padding: '12px 16px' }}><Button variant="sm" onClick={() => setDetailPatient(p)}>View →</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AI MATCHING
// ═══════════════════════════════════════════════════════════════════
function AIMatchingView({ session, patients, trial, running, handleRunAI, docCount, setPage }: {
  session: DemoUser; patients: Patient[]; trial: Trial; running: boolean; handleRunAI: () => void
  docCount: number; setPage: (p: Page) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sorted = [...patients].sort((a, b) => b.eligibilityScore - a.eligibilityScore)
  const selected = patients.find((p) => p.id === selectedId)
  const avg = Math.round(patients.reduce((s, p) => s + p.eligibilityScore, 0) / patients.length)
  const highConf = patients.filter((p) => p.aiConfidence >= 80).length
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', background: C.bg, padding: 24 }}>
        <Card style={{ marginBottom: 20 }}>
          <CardBody style={{ ...flexBetween, flexWrap: 'wrap', gap: 16, padding: 16 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Scoring against <strong style={{ color: C.text }}>{trial.title}</strong> · {trial.phase}</p>
              {trial.protocolCriteria ? (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: C.blue, lineHeight: 1.5 }}>
                  📁 Criteria from Document Center: {trial.protocolCriteria.sourceDocTitle}
                </p>
              ) : (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#B45309', lineHeight: 1.5 }}>
                  ⚠ Parse protocol in{' '}
                  <button type="button" onClick={() => setPage('documents')} style={{ border: 'none', background: 'none', color: C.blue, cursor: 'pointer', fontWeight: 700, padding: 0 }}>Document Center</button>
                  {' '}for trial-specific rules
                </p>
              )}
            </div>
            <div style={{ ...flex, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setPage('documents')}>📁 Document Center</Button>
              {canRunAI(session.role) ? (
                <Button loading={running} onClick={handleRunAI}>🤖 Run AI Matching</Button>
              ) : (
                <span style={{ borderRadius: 12, background: '#F1F5F9', padding: '8px 16px', fontSize: 12, color: C.muted }}>Requires Researcher or Admin role</span>
              )}
            </div>
          </CardBody>
        </Card>
        {running ? <LoadingOverlay message="AI analyzing patient cohort…" /> : <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            {[{ label: 'Total patients', value: patients.length, icon: '👥' }, { label: 'Avg eligibility', value: `${avg}%`, icon: '🎯' },
              { label: 'High confidence', value: highConf, icon: '🤖' }, { label: 'Enrolled', value: `${patients.filter((p) => p.stage === 'Consented').length}/${trial.enrollmentTarget}`, icon: '📋' }].map((item) => (
              <Card key={item.label} style={{ borderLeft: `4px solid ${C.purple}` }}><CardBody style={{ padding: 16 }}>
                <span style={{ fontSize: 20 }}>{item.icon}</span>
                <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: C.purple }}>{item.value}</p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{item.label}</p>
              </CardBody></Card>
            ))}
          </div>
          <Card>
            <CardHeader><span style={{ fontWeight: 700 }}>Ranked patient matches</span><span style={{ float: 'right', fontSize: 12, color: C.slate }}>Click for explainability</span></CardHeader>
            {sorted.map((p, rank) => (
              <button key={p.id} type="button" onClick={() => setSelectedId(p.id)} style={{
                display: 'flex', width: '100%', flexWrap: 'wrap', alignItems: 'center', gap: 16, border: 'none', borderBottom: '1px solid #F8FAFC',
                padding: '12px 20px', textAlign: 'left', cursor: 'pointer', background: selectedId === p.id ? C.blueLight : C.white,
              }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', ...flexCenter, fontSize: 12, fontWeight: 700, background: rank < 3 ? '#059669' : '#F1F5F9', color: rank < 3 ? '#fff' : C.muted }}>#{rank + 1}</span>
                <Avatar name={p.name} size={34} />
                <div style={{ flex: 1, minWidth: 120 }}><p style={{ margin: 0, fontWeight: 600 }}>{p.name}</p><p style={{ margin: 0, fontSize: 12, color: C.muted }}>{p.diagnosis} · {p.aiConfidence}% conf.</p></div>
                <div style={{ width: 160 }}><div style={{ ...flexBetween, fontSize: 12, marginBottom: 4 }}><span>Eligibility</span><strong>{p.eligibilityScore}%</strong></div>
                  <ProgressBar value={p.eligibilityScore} max={100} color={getScoreBarColor(p.eligibilityScore)} /></div>
                <StageBadge stage={p.stage} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#047857' }}>{p.reasons.filter((r) => r.passed).length}/{p.reasons.length} pass</span>
              </button>
            ))}
          </Card>
        </>}
      </div>
      {selected && (
        <aside className="scrollbar-thin" style={{ width: 320, flexShrink: 0, overflowY: 'auto', borderLeft: `1px solid ${C.border}`, background: C.white, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontWeight: 700 }}>AI Explainability</h3>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: C.muted }}>{selected.name}</p>
          <AIExplainPanel patient={selected} trial={trial} docCount={docCount} compact />
        </aside>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROTOCOL & REFERENCE DOCUMENT CENTER
// ═══════════════════════════════════════════════════════════════════
function ExpiryBadge({ expiryDate }: { expiryDate?: string }) {
  const status = docExpiryStatus(expiryDate)
  if (!status) return null
  const meta = status === 'expired'
    ? { label: 'Expired', bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' }
    : status === 'soon'
      ? { label: `Expires in ${daysUntil(expiryDate!)}d`, bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' }
      : { label: 'Valid', bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' }
  return (
    <span style={{ borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
      {meta.label}
    </span>
  )
}

function ProtocolDocumentCenterView({
  trial, documents, session, onUpload, onNewVersion, onParse, onApplyCriteria, setPage, toast,
}: {
  trial: Trial
  documents: TrialDocument[]
  session: DemoUser
  onUpload: (trialId: string, meta: { title: string; category: DocCategory; fileName: string }) => void
  onNewVersion: (docId: string, fileName: string) => void
  onParse: (docId: string) => Promise<void>
  onApplyCriteria: (trialId: string, criteria: ProtocolCriteriaExtract) => void
  setPage: (p: Page) => void
  toast: (msg: string, type?: Toast['type']) => void
}) {
  const [categoryFilter, setCategoryFilter] = useState<DocCategory | 'all'>('all')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState<DocCategory>('protocol')
  const [uploadFileName, setUploadFileName] = useState('')
  const [versionFileName, setVersionFileName] = useState('')

  const trialDocs = useMemo(() => getTrialDocuments(documents, trial.id), [documents, trial.id])
  const filteredDocs = useMemo(() => {
    let list = trialDocs
    if (categoryFilter !== 'all') list = list.filter((d) => d.category === categoryFilter)
    return list
  }, [trialDocs, categoryFilter])
  const selectedDoc = documents.find((d) => d.id === selectedDocId) ?? filteredDocs[0] ?? null
  const protocolDoc = useMemo(() => {
    if (selectedDoc?.category === 'protocol') return selectedDoc
    return trialDocs.find((d) => d.category === 'protocol') ?? null
  }, [selectedDoc, trialDocs])
  const expiring = trialDocs.filter((d) => docExpiryStatus(d.expiryDate) === 'soon')
  const expired = trialDocs.filter((d) => docExpiryStatus(d.expiryDate) === 'expired')
  const statusChip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 600, border: '1px solid transparent' }
  const inp: CSSProperties = { width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.muted }
  const selStyle: CSSProperties = { ...inp, cursor: 'pointer' }

  const handleParseProtocol = async () => {
    if (!protocolDoc) {
      toast('Upload or select a protocol document to parse', 'warn')
      return
    }
    setSelectedDocId(protocolDoc.id)
    setParsing(true)
    await onParse(protocolDoc.id)
    setParsing(false)
  }

  const handleUpload = () => {
    if (!uploadTitle.trim() || !uploadFileName.trim()) return
    onUpload(trial.id, { title: uploadTitle.trim(), category: uploadCategory, fileName: uploadFileName.trim() })
    setShowUpload(false)
    setUploadTitle('')
    setUploadFileName('')
  }

  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      {showUpload && (
        <Modal title="Upload document" onClose={() => setShowUpload(false)}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: C.muted }}>Documents are stored per trial and become the recruitment source of truth for AI matching.</p>
          <label style={lbl}>Title</label>
          <input style={{ ...inp, marginBottom: 12 }} value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Protocol v4.0" />
          <label style={lbl}>Category</label>
          <select style={{ ...selStyle, marginBottom: 12 }} value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value as DocCategory)}>
            {(Object.keys(DOC_CATEGORY_META) as DocCategory[]).map((c) => (
              <option key={c} value={c}>{DOC_CATEGORY_META[c].icon} {DOC_CATEGORY_META[c].label}</option>
            ))}
          </select>
          <label style={lbl}>File (demo — enter filename)</label>
          <input style={{ ...inp, marginBottom: 16 }} value={uploadFileName} onChange={(e) => setUploadFileName(e.target.value)} placeholder="Protocol_v4.pdf" />
          <div style={{ ...flex, justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload}>Upload</Button>
          </div>
        </Modal>
      )}
      {showPreview && selectedDoc && (
        <Modal title={`Preview — ${selectedDoc.title}`} onClose={() => setShowPreview(false)} wide>
          <div style={{ borderRadius: 12, background: '#F8FAFC', padding: 16, marginBottom: 16, maxHeight: 320, overflowY: 'auto' }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted }}>{selectedDoc.fileName} · v{selectedDoc.currentVersion}</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: C.text, whiteSpace: 'pre-wrap' }}>{selectedDoc.contentPreview}</p>
            {selectedDoc.parsedCriteria && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.blue }}>🧠 AI-extracted criteria</p>
                <p style={{ margin: '4px 0', fontSize: 12 }}><strong>Inclusion:</strong> {selectedDoc.parsedCriteria.inclusion.join('; ')}</p>
                <p style={{ margin: '4px 0', fontSize: 12 }}><strong>Exclusion:</strong> {selectedDoc.parsedCriteria.exclusion.join('; ')}</p>
                <p style={{ margin: '4px 0', fontSize: 12 }}><strong>Biomarkers:</strong> {selectedDoc.parsedCriteria.biomarkers.join(', ')}</p>
              </div>
            )}
          </div>
          <div style={{ ...flex, gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(selectedDoc.contentPreview); }}>Copy text</Button>
            <Button variant="secondary" onClick={() => setShowPreview(false)}>Close</Button>
          </div>
        </Modal>
      )}

      <Card style={{ marginBottom: 16 }}>
        <CardBody style={{ padding: '12px 16px' }}>
          <div style={{ ...flexBetween, flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div style={{ ...flex, flexWrap: 'wrap', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{trial.title}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{trialDocs.length} files</span>
              {trial.protocolCriteria && (
                <span style={{ ...statusChip, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0' }} title={trial.protocolCriteria.sourceDocTitle}>
                  ✓ Synced · ages {trial.protocolCriteria.ageMin}–{trial.protocolCriteria.ageMax}
                </span>
              )}
              {protocolDoc?.parsedCriteria && !trial.protocolCriteria && (
                <span style={{ ...statusChip, background: '#F5F3FF', color: C.purple, border: '1px solid #DDD6FE' }}>Parsed — sync pending</span>
              )}
              {expired.map((d) => (
                <button key={d.id} type="button" onClick={() => setSelectedDocId(d.id)}
                  style={{ ...statusChip, background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Expired: {d.title.length > 28 ? `${d.title.slice(0, 28)}…` : d.title}
                </button>
              ))}
              {expiring.map((d) => (
                <button key={d.id} type="button" onClick={() => setSelectedDocId(d.id)}
                  style={{ ...statusChip, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Expires in {daysUntil(d.expiryDate!)}d
                </button>
              ))}
            </div>
            <div style={{ ...flex, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="sm" onClick={() => setShowUpload(true)}>+ Upload</Button>
              {canRunAI(session.role) && protocolDoc && (
                <>
                  <Button variant="sm" loading={parsing} onClick={handleParseProtocol}>Parse with AI</Button>
                  {protocolDoc.parsedCriteria && (
                    <Button variant="sm" onClick={() => onApplyCriteria(trial.id, protocolDoc.parsedCriteria!)}>Sync to trial</Button>
                  )}
                </>
              )}
              {trial.protocolCriteria && (
                <>
                  <Button variant="ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setPage('ai')}>AI Matching</Button>
                  <Button variant="ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setPage('patients')}>Patients</Button>
                </>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(248px, 280px) minmax(280px, 1fr) minmax(300px, 360px)', gap: 20, alignItems: 'start' }}>
        <Card style={{ minWidth: 0 }}>
          <CardHeader><span style={{ fontWeight: 700, fontSize: 13 }}>Categories</span></CardHeader>
          <CardBody style={{ padding: 8 }}>
            {(['all', ...Object.keys(DOC_CATEGORY_META)] as const).map((cat) => {
              const count = cat === 'all' ? trialDocs.length : trialDocs.filter((d) => d.category === cat).length
              const label = cat === 'all' ? 'All documents' : DOC_CATEGORY_META[cat as DocCategory].label
              const icon = cat === 'all' ? '📁' : DOC_CATEGORY_META[cat as DocCategory].icon
              const active = categoryFilter === cat
              return (
                <button key={cat} type="button" onClick={() => setCategoryFilter(cat as DocCategory | 'all')}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'flex-start', gap: 10,
                    border: active ? `1px solid #BFDBFE` : '1px solid transparent',
                    borderRadius: 10, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', textAlign: 'left',
                    fontSize: 12, fontWeight: 600, lineHeight: 1.4,
                    background: active ? C.blueLight : 'transparent', color: active ? C.blue : C.text,
                  }}>
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }} aria-hidden>{icon}</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>{label}</span>
                  <span style={{
                    flexShrink: 0, minWidth: 22, textAlign: 'center', fontSize: 11, fontWeight: 700,
                    color: active ? C.blue : C.muted, background: active ? '#fff' : '#F1F5F9',
                    borderRadius: 999, padding: '2px 8px', border: `1px solid ${active ? '#BFDBFE' : '#E2E8F0'}`,
                  }}>{count}</span>
                </button>
              )
            })}
          </CardBody>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredDocs.length === 0 ? (
            <Card><EmptyState title="No documents" description="Upload protocol or reference files for this trial." /></Card>
          ) : filteredDocs.map((doc) => {
            const ver = doc.versions.find((v) => v.version === doc.currentVersion)
            const isSel = selectedDoc?.id === doc.id
            return (
              <Card key={doc.id} style={{ border: isSel ? `2px solid ${C.blue}` : undefined, cursor: 'pointer' }} onClick={() => setSelectedDocId(doc.id)}>
                <CardBody style={{ padding: 14 }}>
                  <div style={{ ...flexBetween, alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{DOC_CATEGORY_META[doc.category].label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 700 }}>{doc.title}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>{doc.fileName} · v{doc.currentVersion}{ver ? ` · ${ver.fileSizeKb} KB` : ''}</p>
                    </div>
                    <ExpiryBadge expiryDate={doc.expiryDate} />
                  </div>
                  {doc.parsedCriteria && (
                    <span style={{ display: 'inline-block', marginTop: 8, borderRadius: 8, background: '#F5F3FF', color: C.purple, padding: '3px 8px', fontSize: 10, fontWeight: 700 }}>🧠 AI parsed</span>
                  )}
                  <div style={{ ...flex, gap: 6, marginTop: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                    <Button variant="sm" onClick={() => { setSelectedDocId(doc.id); setShowPreview(true) }}>Preview</Button>
                    <Button variant="sm" onClick={() => toast(`Download started: ${doc.fileName}`)}>Download</Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>

        <Card style={{ position: 'sticky', top: 0 }}>
          <CardHeader><span style={{ fontWeight: 700 }}>Document detail</span></CardHeader>
          <CardBody>
            {!selectedDoc ? (
              <EmptyState title="Select a document" description="Choose a file to view versions, parse protocol, or manage expiry." />
            ) : (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>{selectedDoc.title}</p>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted }}>Uploaded by {userName(selectedDoc.uploadedBy)} · Updated {selectedDoc.updatedAt}</p>
                <ExpiryBadge expiryDate={selectedDoc.expiryDate} />
                <p style={{ margin: '16px 0 8px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Version history</p>
                {selectedDoc.versions.slice().reverse().map((v) => (
                  <div key={v.version} style={{
                    borderRadius: 10, padding: 10, marginBottom: 8, fontSize: 12,
                    background: v.version === selectedDoc.currentVersion ? C.blueLight : '#F8FAFC',
                    border: v.version === selectedDoc.currentVersion ? `1px solid #BFDBFE` : '1px solid transparent',
                  }}>
                    <div style={flexBetween}>
                      <strong>{v.label} — {v.fileName}</strong>
                      {v.version === selectedDoc.currentVersion && <span style={{ fontSize: 10, color: C.blue, fontWeight: 700 }}>Current</span>}
                    </div>
                    <p style={{ margin: '4px 0 0', color: C.muted }}>{v.uploadedAt} · {userName(v.uploadedBy)} · {v.fileSizeKb} KB</p>
                    {v.notes && <p style={{ margin: '4px 0 0', fontStyle: 'italic' }}>{v.notes}</p>}
                  </div>
                ))}
                {canManageTrials(session.role) && (
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Upload new version</label>
                    <div style={{ ...flex, gap: 8 }}>
                      <input style={{ ...inp, flex: 1 }} value={versionFileName} onChange={(e) => setVersionFileName(e.target.value)} placeholder="Protocol_v3.3.pdf" />
                      <Button variant="sm" onClick={() => { if (versionFileName.trim()) { onNewVersion(selectedDoc.id, versionFileName.trim()); setVersionFileName('') } }}>Add</Button>
                    </div>
                  </div>
                )}
                {selectedDoc.category === 'protocol' && (trial.protocolCriteria || selectedDoc.parsedCriteria) && (() => {
                  const crit = trial.protocolCriteria?.sourceDocId === selectedDoc.id ? trial.protocolCriteria : selectedDoc.parsedCriteria
                  if (!crit) return null
                  const synced = trial.protocolCriteria?.sourceDocId === selectedDoc.id
                  return (
                    <div style={{ marginTop: 16, borderRadius: 10, background: synced ? C.blueLight : '#F5F3FF', padding: 12, fontSize: 11, lineHeight: 1.5, border: `1px solid ${synced ? '#BFDBFE' : '#DDD6FE'}` }}>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: synced ? C.blue : C.purple }}>
                        {synced ? '✓ Synced criteria' : 'Extracted criteria'}
                      </p>
                      <p style={{ margin: '0 0 6px' }}><strong>Ages {crit.ageMin}–{crit.ageMax}</strong> · {crit.biomarkers.slice(0, 2).join(', ')}</p>
                      <p style={{ margin: '0 0 4px', color: '#047857' }}><strong>Inclusion:</strong> {crit.inclusion[0]}</p>
                      <p style={{ margin: 0, color: '#B91C1C' }}><strong>Exclusion:</strong> {crit.exclusion[0]}</p>
                      {!synced && <p style={{ margin: '8px 0 0', fontSize: 10, color: C.muted }}>Use toolbar above to sync to AI matching.</p>}
                    </div>
                  )
                })()}
                <div style={{ ...flex, gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <Button variant="secondary" onClick={() => setShowPreview(true)}>Preview</Button>
                  <Button variant="secondary" onClick={() => toast(`Share link copied for ${selectedDoc.title}`)}>Share link</Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRIAL WORKSPACE — Phase 3 components
// ═══════════════════════════════════════════════════════════════════
type TrialTab = 'overview' | 'pipeline' | 'team' | 'settings'

function StageDistributionBar({ patients }: { patients: Patient[] }) {
  const total = patients.length
  if (total === 0) return <p style={{ fontSize: 13, color: C.slate, margin: 0 }}>No patients in this trial yet.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {STAGES.map((stage) => {
        const count = patients.filter((p) => p.stage === stage).length
        const pct = Math.round((count / total) * 100)
        const m = STAGE_META[stage]
        return (
          <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 82, fontSize: 11, fontWeight: 600, color: m.color, flexShrink: 0 }}>{m.icon} {stage}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#E2E8F0', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: m.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ width: 24, fontSize: 11, fontWeight: 700, color: C.muted, textAlign: 'right' }}>{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function RecruitmentProgressRing({ enrolled, goal, size = 80 }: { enrolled: number; goal: number; size?: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((enrolled / goal) * 100)) : 0
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const fill = circ * (1 - pct / 100)
  const color = pct >= 80 ? '#047857' : pct >= 50 ? C.blue : '#B45309'
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x="50%" y="42%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.22} fontWeight={800} fill={color}>{pct}%</text>
      <text x="50%" y="65%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.12} fill={C.muted}>enrolled</text>
    </svg>
  )
}

function TrialMetricTile({ label, value, sub, color = C.blue }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, padding: '12px 14px', background: C.white, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 800, color }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: C.slate }}>{sub}</span>}
    </div>
  )
}

function TrialWorkspacePanel({
  trial, patients, users, session, activeTrialId,
  onSetActive, onSaveTrial, onArchiveTrial, setPage, docCount,
  stageChange, setDetailPatient, addOutreach,
}: {
  trial: Trial; patients: Patient[]; users: DemoUser[]; session: DemoUser
  activeTrialId: string; onSetActive: (id: string) => void; onSaveTrial: (t: Trial) => void
  onArchiveTrial: (id: string) => void; setPage: (p: Page) => void; docCount: number
  stageChange: (pid: string, stage: RecruitStage) => void
  setDetailPatient: (p: Patient) => void
  addOutreach: (pid: string, rec: OutreachRecord) => void
}) {
  const [tab, setTab] = useState<TrialTab>('overview')
  const [showEdit, setShowEdit] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Pick<Trial, 'recruitmentStatus' | 'recruitmentTarget' | 'enrollmentGoal' | 'startDate' | 'endDate' | 'description'>>({
    recruitmentStatus: trial.recruitmentStatus,
    recruitmentTarget: trial.recruitmentTarget,
    enrollmentGoal: trial.enrollmentGoal,
    startDate: trial.startDate,
    endDate: trial.endDate,
    description: trial.description,
  })

  useEffect(() => {
    setSettingsForm({
      recruitmentStatus: trial.recruitmentStatus,
      recruitmentTarget: trial.recruitmentTarget,
      enrollmentGoal: trial.enrollmentGoal,
      startDate: trial.startDate,
      endDate: trial.endDate,
      description: trial.description,
    })
  }, [trial.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = trial.id === activeTrialId
  const trialPatients = patients.filter((p) => p.trialId === trial.id)
  const consented = trialPatients.filter((p) => p.stage === 'Consented').length
  const daysLeft = daysUntil(trial.endDate)
  const owner = users.find((u) => u.id === trial.ownerId)
  const recruiters = users.filter((u) => trial.recruiterIds.includes(u.id))
  const unassigned = users.filter((u) => u.id !== trial.ownerId && !trial.recruiterIds.includes(u.id))

  const inp: CSSProperties = { width: '100%', borderRadius: 10, border: `1.5px solid ${C.border}`, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: CSSProperties = { display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }

  const TABS: { id: TrialTab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '⊞' },
    { id: 'pipeline', label: 'Pipeline', icon: '🔄' },
    { id: 'team', label: 'Team', icon: '👥' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const saveSettings = () => {
    onSaveTrial(syncTrialEnrollment({
      ...trial,
      ...settingsForm,
      enrollmentTarget: settingsForm.enrollmentGoal,
      updatedAt: TODAY,
    }))
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 120px)', overflow: 'hidden', position: 'sticky', top: 0 }}>
      {showEdit && (
        <TrialFormModal trial={trial} users={users} onClose={() => setShowEdit(false)}
          onSave={(t) => { onSaveTrial(t); setShowEdit(false) }} />
      )}

      {/* Panel header */}
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ ...flexBetween, marginBottom: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{trial.protocolId} · {trial.phase}</p>
            <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trial.title}</p>
          </div>
          <div style={{ ...flex, gap: 5, flexShrink: 0, marginLeft: 10, alignItems: 'center' }}>
            <TrialStatusBadge status={trial.archived ? 'Archived' : trial.recruitmentStatus} />
            {isActive && <span style={{ borderRadius: 999, background: C.blue, color: '#fff', padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>Active</span>}
          </div>
        </div>
        <div style={{ ...flex, gap: 6, flexWrap: 'wrap' }}>
          {!trial.archived && !isActive && <Button variant="sm" onClick={() => onSetActive(trial.id)}>Use this trial</Button>}
          {canManageTrials(session.role) && !trial.archived && <Button variant="sm" onClick={() => setShowEdit(true)}>✏️ Edit</Button>}
          <Button variant="sm" onClick={() => { onSetActive(trial.id); setPage('dashboard') }}>Dashboard →</Button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: '#FAFBFF', flexShrink: 0 }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '9px 4px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: tab === t.id ? C.blue : C.muted, borderBottom: `2px solid ${tab === t.id ? C.blue : 'transparent'}`, transition: 'all 0.15s', fontFamily: 'inherit' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: tab === 'pipeline' ? 0 : 16 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <TrialMetricTile label="Total patients" value={trialPatients.length} sub={`of ${trial.recruitmentTarget} target`} />
              <TrialMetricTile label="Consented" value={consented} sub={`of ${trial.enrollmentGoal} goal`} color="#047857" />
              <TrialMetricTile label="Days remaining" value={daysLeft > 0 ? daysLeft : 'Ended'} sub={trial.endDate}
                color={daysLeft < 0 ? '#64748B' : daysLeft < 30 ? '#B91C1C' : daysLeft < 90 ? '#B45309' : C.blue} />
              <TrialMetricTile label="Team" value={recruiters.length + (owner ? 1 : 0)} sub={`${docCount} doc${docCount !== 1 ? 's' : ''} on file`} color={C.purple} />
            </div>

            <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, padding: 14, background: C.white }}>
              <div style={{ ...flex, alignItems: 'center', gap: 14, marginBottom: 12 }}>
                <RecruitmentProgressRing enrolled={consented} goal={trial.enrollmentGoal} size={80} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: C.text }}>Enrollment progress</p>
                  <p style={{ margin: '0 0 6px', fontSize: 11, color: C.muted }}>{consented} consented · {trial.enrollmentGoal} goal</p>
                  <ProgressBar value={consented} max={trial.enrollmentGoal} color="#047857" />
                  <p style={{ margin: '10px 0 4px', fontSize: 11, color: C.muted }}>Recruitment pipeline</p>
                  <ProgressBar value={trialPatients.length} max={trial.recruitmentTarget} color={C.blue} />
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: C.slate }}>{trialPatients.length} in pipeline · {trial.recruitmentTarget} target</p>
                </div>
              </div>
            </div>

            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Recruitment funnel</p>
              <StageDistributionBar patients={trialPatients} />
            </div>

            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Trial details</p>
              {([
                ['Sponsor', trial.sponsor || '—'],
                ['Therapeutic area', trial.therapeuticArea || '—'],
                ['Condition', trial.condition],
                ['Age range', `${trial.ageRange.min}–${trial.ageRange.max} years`],
                ['Sites', trial.sites.length ? `${trial.sites.length} site${trial.sites.length !== 1 ? 's' : ''}` : 'None configured'],
                ['Protocol criteria', trial.protocolCriteria ? '✓ Synced from protocol doc' : 'Upload protocol PDF to enable AI'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ ...flexBetween, padding: '7px 0', borderBottom: `1px solid #F8FAFC`, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: C.muted }}>{k}</span>
                  <span style={{ textAlign: 'right', maxWidth: '58%', color: C.text }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Button variant="secondary" onClick={() => { onSetActive(trial.id); setPage('documents') }}>📁 Documents</Button>
              <Button variant="secondary" onClick={() => { onSetActive(trial.id); setPage('patients') }}>👥 Patients ({trialPatients.length})</Button>
              <Button variant="secondary" onClick={() => { onSetActive(trial.id); setPage('analytics') }}>📊 Analytics</Button>
            </div>
          </div>
        )}

        {/* ── PIPELINE ── */}
        {tab === 'pipeline' && (
          trialPatients.length === 0 ? (
            <div style={{ padding: 16 }}>
              <EmptyState icon="🔄" title="No patients in pipeline" description="Add patients to start managing the recruitment pipeline." />
              <div style={{ ...flexCenter, marginTop: 12, gap: 8 }}>
                <Button variant="secondary" onClick={() => { onSetActive(trial.id); setPage('patients') }}>Add patients</Button>
              </div>
            </div>
          ) : (
            <div style={{ height: 520 }}>
              <KanbanView patients={trialPatients} role={session.role} stageChange={stageChange}
                setDetailPatient={setDetailPatient} addOutreach={addOutreach} />
            </div>
          )
        )}

        {/* ── TEAM ── */}
        {tab === 'team' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Trial owner</p>
              {owner ? (
                <div style={{ ...flex, gap: 12, alignItems: 'center', borderRadius: 12, border: `1px solid ${C.border}`, padding: '12px 14px', background: C.white }}>
                  <Avatar name={owner.name} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{owner.name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{owner.email}</p>
                  </div>
                  <span style={{ borderRadius: 8, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: ROLE_META[owner.role].color, background: ROLE_META[owner.role].bg, flexShrink: 0 }}>
                    {ROLE_META[owner.role].label}
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: C.slate }}>No owner assigned.</p>
              )}
            </div>

            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Assigned recruiters ({recruiters.length})</p>
              {recruiters.length === 0 ? (
                <p style={{ fontSize: 13, color: C.slate }}>No recruiters assigned. Edit the trial to assign recruiters.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recruiters.map((r) => (
                    <div key={r.id} style={{ ...flex, gap: 12, alignItems: 'center', borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px 14px', background: C.white }}>
                      <Avatar name={r.name} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{r.name}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{r.email}</p>
                      </div>
                      <span style={{ borderRadius: 8, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: ROLE_META[r.role].color, background: ROLE_META[r.role].bg, flexShrink: 0 }}>
                        {ROLE_META[r.role].label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {unassigned.length > 0 && (
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Other org members</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {unassigned.map((u) => (
                    <div key={u.id} style={{ ...flex, gap: 10, alignItems: 'center', borderRadius: 10, padding: '8px 12px', background: '#F8FAFC', border: `1px solid ${C.border}` }}>
                      <Avatar name={u.name} size={28} />
                      <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{u.name}</span>
                      <span style={{ borderRadius: 8, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: ROLE_META[u.role].color, background: ROLE_META[u.role].bg }}>
                        {ROLE_META[u.role].label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canManageTrials(session.role) && (
              <Button variant="secondary" onClick={() => setShowEdit(true)}>✏️ Manage team assignments</Button>
            )}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === 'settings' && (
          canManageTrials(session.role) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Recruitment settings</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={lbl}>Recruitment status</label>
                    <select style={inp} value={settingsForm.recruitmentStatus}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, recruitmentStatus: e.target.value as TrialRecruitmentStatus }))}>
                      {(Object.keys(TRIAL_STATUS_META) as TrialRecruitmentStatus[]).filter((s) => s !== 'Archived').map((s) => (
                        <option key={s} value={s}>{TRIAL_STATUS_META[s].label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={lbl}>Recruitment target</label>
                      <input type="number" style={inp} value={settingsForm.recruitmentTarget}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, recruitmentTarget: Number(e.target.value) }))} />
                    </div>
                    <div>
                      <label style={lbl}>Enrollment goal</label>
                      <input type="number" style={inp} value={settingsForm.enrollmentGoal}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, enrollmentGoal: Number(e.target.value) }))} />
                    </div>
                    <div>
                      <label style={lbl}>Start date</label>
                      <input type="date" style={inp} value={settingsForm.startDate}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, startDate: e.target.value }))} />
                    </div>
                    <div>
                      <label style={lbl}>End date</label>
                      <input type="date" style={inp} value={settingsForm.endDate}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, endDate: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Trial description</label>
                    <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={settingsForm.description}
                      onChange={(e) => setSettingsForm((f) => ({ ...f, description: e.target.value }))} />
                  </div>
                  <Button onClick={saveSettings}>Save settings</Button>
                </div>
              </div>

              <div>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }}>Trial sites ({trial.sites.length})</p>
                {trial.sites.length === 0 ? (
                  <p style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>No sites configured.</p>
                ) : (
                  trial.sites.map((s) => (
                    <div key={s.id} style={{ borderRadius: 10, background: '#F8FAFC', border: `1px solid ${C.border}`, padding: '10px 12px', marginBottom: 8 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{s.name}</p>
                      <p style={{ margin: '2px 0 0', color: C.muted, fontSize: 12 }}>{s.city}, {s.country}</p>
                    </div>
                  ))
                )}
                <Button variant="secondary" onClick={() => setShowEdit(true)}>Edit sites & metadata</Button>
              </div>

              {!trial.archived && (
                <div style={{ borderRadius: 12, border: '1px solid #FECACA', background: '#FEF2F2', padding: 14 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: 0.5 }}>Danger zone</p>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: '#7F1D1D' }}>Archiving removes this trial from active recruitment. All data is preserved.</p>
                  {confirmArchive ? (
                    <div style={{ ...flex, gap: 8 }}>
                      <Button variant="danger" onClick={() => { onArchiveTrial(trial.id); setConfirmArchive(false) }}>Confirm archive</Button>
                      <Button variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirmArchive(true)}>Archive trial</Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="🔒" title="Admin only" description="Trial settings can only be modified by administrators." />
          )
        )}
      </div>
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRIALS MODULE
// ═══════════════════════════════════════════════════════════════════
function sitesToText(sites: TrialSite[]): string {
  return sites.map((s) => `${s.name}, ${s.city}, ${s.country}`).join('\n')
}

function parseSites(text: string): TrialSite[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [name = 'Site', city = '', country = ''] = line.split(',').map((p) => p.trim())
      return { id: `s-${Date.now()}-${i}`, name, city, country }
    })
}

function emptyTrialForm(ownerId: string): Trial {
  return syncTrialEnrollment(mkTrial({
    id: '',
    title: '',
    protocolId: '',
    sponsor: '',
    phase: 'Phase II',
    therapeuticArea: '',
    condition: '',
    description: '',
    recruitmentTarget: 50,
    enrollmentGoal: 40,
    recruitmentStatus: 'Planned',
    ageRange: { min: 18, max: 75 },
    targetConditions: [],
    sites: [],
    startDate: TODAY,
    endDate: daysAgo(-365),
    ownerId,
    recruiterIds: [],
    archived: false,
  }))
}

function TrialFormModal({ trial, onClose, onSave, users }: {
  trial: Trial | null
  onClose: () => void
  onSave: (t: Trial) => void
  users: DemoUser[]
}) {
  const isEdit = !!trial?.id
  const defaultOwner = users.find((u) => u.role === 'admin')?.id ?? users[0]?.id ?? ''
  const [form, setForm] = useState<Trial>(() => trial ? { ...trial } : emptyTrialForm(defaultOwner))
  const [sitesText, setSitesText] = useState(() => sitesToText(trial?.sites ?? []))
  const [conditionsText, setConditionsText] = useState(() => (trial?.targetConditions ?? []).join(', '))
  const inp: CSSProperties = { width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted, letterSpacing: 0.5 }
  const set = <K extends keyof Trial>(k: K, v: Trial[K]) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.title.trim() || !form.protocolId.trim()) return
    onSave(syncTrialEnrollment({
      ...form,
      targetConditions: conditionsText.split(',').map((c) => c.trim()).filter(Boolean),
      sites: parseSites(sitesText),
      updatedAt: TODAY,
      id: form.id || `T${Date.now()}`,
      createdAt: form.createdAt || TODAY,
    }))
    onClose()
  }

  return (
    <Modal title={isEdit ? 'Edit trial' : 'Create trial'} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Trial title *</label>
          <input style={inp} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. GLYCOCONTROL-301" />
        </div>
        <div>
          <label style={lbl}>Protocol ID *</label>
          <input style={inp} value={form.protocolId} onChange={(e) => set('protocolId', e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Sponsor</label>
          <input style={inp} value={form.sponsor} onChange={(e) => set('sponsor', e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Trial phase</label>
          <select style={inp} value={form.phase} onChange={(e) => set('phase', e.target.value)}>
            {['Phase I', 'Phase II', 'Phase III', 'Phase IV', 'Observational'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Recruitment status</label>
          <select style={inp} value={form.recruitmentStatus} onChange={(e) => set('recruitmentStatus', e.target.value as TrialRecruitmentStatus)}>
            {(Object.keys(TRIAL_STATUS_META) as TrialRecruitmentStatus[]).filter((s) => s !== 'Archived').map((s) => (
              <option key={s} value={s}>{TRIAL_STATUS_META[s].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={lbl}>Therapeutic area</label>
          <input style={inp} value={form.therapeuticArea} onChange={(e) => set('therapeuticArea', e.target.value)} placeholder="e.g. Endocrinology" />
        </div>
        <div>
          <label style={lbl}>Disease / condition</label>
          <input style={inp} value={form.condition} onChange={(e) => set('condition', e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Recruitment target</label>
          <input type="number" style={inp} value={form.recruitmentTarget} onChange={(e) => set('recruitmentTarget', Number(e.target.value))} />
        </div>
        <div>
          <label style={lbl}>Enrollment goal</label>
          <input type="number" style={inp} value={form.enrollmentGoal} onChange={(e) => { const v = Number(e.target.value); set('enrollmentGoal', v); set('enrollmentTarget', v) }} />
        </div>
        <div>
          <label style={lbl}>Age min</label>
          <input type="number" style={inp} value={form.ageRange.min} onChange={(e) => set('ageRange', { ...form.ageRange, min: Number(e.target.value) })} />
        </div>
        <div>
          <label style={lbl}>Age max</label>
          <input type="number" style={inp} value={form.ageRange.max} onChange={(e) => set('ageRange', { ...form.ageRange, max: Number(e.target.value) })} />
        </div>
        <div>
          <label style={lbl}>Start date</label>
          <input type="date" style={inp} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div>
          <label style={lbl}>End date</label>
          <input type="date" style={inp} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Trial owner</label>
          <select style={inp} value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            {users.filter((u) => u.role === 'admin' || u.role === 'researcher').map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {ROLE_META[u.role].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={lbl}>Recruiter assignments</label>
          <select multiple style={{ ...inp, minHeight: 88 }} value={form.recruiterIds}
            onChange={(e) => set('recruiterIds', Array.from(e.target.selectedOptions, (o) => o.value))}>
            {users.filter((u) => u.role === 'recruiter' || u.role === 'admin').map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: C.slate }}>Hold Cmd/Ctrl to select multiple</p>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Target conditions (comma-separated)</label>
          <input style={inp} value={conditionsText} onChange={(e) => setConditionsText(e.target.value)} placeholder="Type 2 Diabetes, T2DM" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Trial description</label>
          <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Sites (one per line: Name, City, Country)</label>
          <textarea style={{ ...inp, minHeight: 88, resize: 'vertical' }} value={sitesText} onChange={(e) => setSitesText(e.target.value)}
            placeholder="Metro Diabetes Center, Boston, USA" />
        </div>
      </div>
      <div style={{ ...flex, justifyContent: 'flex-end', gap: 12, marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>{isEdit ? 'Save changes' : 'Create trial'}</Button>
      </div>
    </Modal>
  )
}

function TrialsView({ trials, patients, activeTrialId, session, onSetActive, onSaveTrial, onArchiveTrial, setPage, docCountByTrial, users, stageChange, setDetailPatient, addOutreach }: {
  trials: Trial[]
  patients: Patient[]
  activeTrialId: string
  session: DemoUser
  onSetActive: (id: string) => void
  onSaveTrial: (t: Trial) => void
  onArchiveTrial: (id: string) => void
  setPage: (p: Page) => void
  docCountByTrial: (trialId: string) => number
  users: DemoUser[]
  stageChange: (pid: string, stage: RecruitStage) => void
  setDetailPatient: (p: Patient) => void
  addOutreach: (pid: string, rec: OutreachRecord) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Trial | null>(null)
  const [viewArchived, setViewArchived] = useState(false)
  const [selectedTrialId, setSelectedTrialId] = useState<string>(activeTrialId)

  useEffect(() => {
    setSelectedTrialId(activeTrialId)
  }, [activeTrialId])

  const visible = trials.filter((t) => viewArchived || !t.archived)
  const detail = trials.find((t) => t.id === selectedTrialId) ?? trials.find((t) => t.id === activeTrialId)
  const patientCount = (tid: string) => patients.filter((p) => p.trialId === tid).length
  const consentedCount = (tid: string) => patients.filter((p) => p.trialId === tid && p.stage === 'Consented').length

  const selectTrial = (id: string) => setSelectedTrialId(id)

  const activateTrial = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    onSetActive(id)
    setSelectedTrialId(id)
  }

  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      {showForm && (
        <TrialFormModal trial={editing} users={users} onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={(t) => { onSaveTrial(t); setShowForm(false); setEditing(null); if (!editing) onSetActive(t.id) }} />
      )}
      <div style={{ ...flexBetween, flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Trial overview</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: C.muted }}>Set up and manage recruitment trials — the entry point for all recruitment work</p>
        </div>
        <div style={{ ...flex, gap: 10, flexWrap: 'wrap' }}>
          <label style={{ ...flex, alignItems: 'center', gap: 6, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={viewArchived} onChange={(e) => setViewArchived(e.target.checked)} /> Show archived
          </label>
          {canManageTrials(session.role) && (
            <Button onClick={() => { setEditing(null); setShowForm(true) }}>+ Create trial</Button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.2fr)', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.length === 0 ? (
            <Card><EmptyState title="No trials" description="Create a trial to begin patient recruitment." /></Card>
          ) : visible.map((t) => {
            const isActive = t.id === activeTrialId
            const isSelected = t.id === selectedTrialId
            const enrolled = consentedCount(t.id)
            const cardBorder = isActive
              ? `2px solid ${C.blue}`
              : isSelected
                ? `2px solid ${C.teal}`
                : `1px solid ${C.border}`
            const cardBg = isActive ? C.blueLight : isSelected ? '#F0FDFA' : C.white
            return (
              <Card
                key={t.id}
                style={{
                  border: cardBorder,
                  background: cardBg,
                  opacity: t.archived ? 0.75 : 1,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onClick={() => selectTrial(t.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTrial(t.id) } }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Select trial ${t.title}`}
              >
                <CardBody style={{ padding: 16 }}>
                  <div style={{ ...flexBetween, alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted }}>{t.protocolId}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: C.text }}>{t.title}</p>
                    </div>
                    <TrialStatusBadge status={t.archived ? 'Archived' : t.recruitmentStatus} />
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: C.muted }}>{t.condition} · {t.phase}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 12 }}>
                    <span><strong>{patientCount(t.id)}</strong> patients</span>
                    <span><strong>{enrolled}/{t.enrollmentGoal}</strong> enrolled</span>
                    <span style={{ color: C.muted }}>Owner: {userName(t.ownerId).split(' ').slice(-1).join(' ')}</span>
                    <span style={{ color: C.muted }}>{t.recruiterIds.length} recruiter{t.recruiterIds.length !== 1 ? 's' : ''}</span>
                  </div>
                  {isActive && (
                    <span style={{ display: 'inline-block', marginBottom: 10, borderRadius: 8, background: C.blue, color: '#fff', padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                      ✓ Active trial — all modules use this protocol
                    </span>
                  )}
                  {isSelected && !isActive && (
                    <span style={{ display: 'inline-block', marginBottom: 10, borderRadius: 8, background: '#CCFBF1', color: '#0F766E', padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
                      Selected — click “Use this trial” to activate
                    </span>
                  )}
                  <div style={{ ...flex, flexWrap: 'wrap', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    {!t.archived && !isActive && (
                      <Button variant="sm" onClick={(e) => activateTrial(t.id, e)}>Use this trial</Button>
                    )}
                    {!t.archived && isActive && (
                      <Button variant="sm" onClick={(e) => { e.stopPropagation(); setPage('dashboard') }}>Open dashboard →</Button>
                    )}
                    {canManageTrials(session.role) && !t.archived && (
                      <Button variant="sm" onClick={(e) => { e.stopPropagation(); setEditing(t); setShowForm(true) }}>Edit</Button>
                    )}
                    {canManageTrials(session.role) && !t.archived && (
                      <Button variant="ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={(e) => { e.stopPropagation(); onArchiveTrial(t.id) }}>Archive</Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>

        <div>
          {detail ? (
            <TrialWorkspacePanel
              trial={detail}
              patients={patients}
              users={users}
              session={session}
              activeTrialId={activeTrialId}
              onSetActive={(id) => { onSetActive(id); setSelectedTrialId(id) }}
              onSaveTrial={onSaveTrial}
              onArchiveTrial={onArchiveTrial}
              setPage={setPage}
              docCount={docCountByTrial(detail.id)}
              stageChange={stageChange}
              setDetailPatient={setDetailPatient}
              addOutreach={addOutreach}
            />
          ) : (
            <Card><EmptyState title="Select a trial" description="Choose a trial from the list to view its workspace." /></Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// OUTREACH MODULE
// ═══════════════════════════════════════════════════════════════════
function OutreachView({ patients, role, setDetailPatient, addOutreach }: {
  patients: Patient[]; role: Role; setDetailPatient: (p: Patient) => void
  addOutreach: (pid: string, rec: OutreachRecord) => void
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const allOutreach = useMemo(() =>
    patients.flatMap((p) => p.outreach.map((o) => ({ ...o, patientId: p.id, patientName: p.name, stage: p.stage })))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)), [patients])
  const filtered = statusFilter === 'all' ? allOutreach : allOutreach.filter((o) => o.status === statusFilter)
  const stats = {
    sent: allOutreach.filter((o) => o.status === 'sent').length,
    delivered: allOutreach.filter((o) => o.status === 'delivered').length,
    opened: allOutreach.filter((o) => o.status === 'opened').length,
    responded: allOutreach.filter((o) => o.status === 'responded').length,
  }
  const responseRate = allOutreach.length > 0 ? Math.round((stats.responded / allOutreach.length) * 100) : 0
  const followUps = patients.filter((p) => p.outreach.some((o) => o.followUpDate) || (p.stage === 'Contacted' && p.outreach.length > 0))
  const selStyle: CSSProperties = { borderRadius: 12, border: `2px solid ${C.border}`, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit' }
  const statusColors: Record<string, string> = { sent: '#1D4ED8', delivered: '#4F46E5', opened: C.teal, responded: '#047857', scheduled: '#B45309', failed: '#B91C1C' }

  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      {selectedPatient && canManageOutreach(role) && (
        <OutreachModal patient={selectedPatient} onClose={() => setSelectedPatient(null)}
          onSend={(rec) => { addOutreach(selectedPatient.id, rec); setSelectedPatient(null) }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[{ label: 'Sent', value: stats.sent }, { label: 'Delivered', value: stats.delivered }, { label: 'Opened', value: stats.opened },
          { label: 'Responded', value: stats.responded }, { label: 'Success rate', value: `${responseRate}%` }].map((s) => (
          <Card key={s.label}><CardBody style={{ padding: 16 }}>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.blue }}>{s.value}</p>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{s.label}</p>
          </CardBody></Card>
        ))}
      </div>
      <div style={{ ...flex, flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <select style={selStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(OUTREACH_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {canManageOutreach(role) && (
          <select style={selStyle} defaultValue="" onChange={(e) => { const p = patients.find((x) => x.id === e.target.value); if (p) setSelectedPatient(p); e.target.value = '' }}>
            <option value="">+ New outreach…</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Card>
          <CardHeader><span style={{ fontWeight: 700 }}>Outreach timeline</span></CardHeader>
          {filtered.length === 0 ? <EmptyState title="No outreach records" description="Send your first message from a patient profile or pipeline card." /> : (
            <div className="scrollbar-thin" style={{ maxHeight: 420, overflowY: 'auto', padding: 16 }}>
              {filtered.map((o) => (
                <div key={o.id + o.patientId} style={{ borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, marginBottom: 10, background: C.white }}>
                  <div style={flexBetween}>
                    <div style={{ ...flex, gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{o.channel === 'email' ? '📧' : o.channel === 'sms' ? '📱' : '📞'}</span>
                      <div><p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{o.template}</p>
                        <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{o.patientName} · {o.sentAt}</p></div>
                    </div>
                    <span style={{ borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: statusColors[o.status], background: `${statusColors[o.status]}18` }}>
                      {OUTREACH_STATUS_LABELS[o.status]}
                    </span>
                  </div>
                  {o.followUpDate && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#B45309' }}>📅 Follow-up: {o.followUpDate}</p>}
                  <div style={{ ...flex, gap: 8, marginTop: 10 }}><StageBadge stage={o.stage} /><Button variant="sm" onClick={() => setDetailPatient(patients.find((p) => p.id === o.patientId)!)}>View patient</Button></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader><span style={{ fontWeight: 700 }}>Follow-up reminders</span></CardHeader>
          <CardBody>
            {followUps.length === 0 ? <EmptyState icon="📅" title="No follow-ups scheduled" description="Add a follow-up date when sending outreach." /> :
              followUps.map((p) => {
                const next = p.outreach.find((o) => o.followUpDate)?.followUpDate
                return (
                  <div key={p.id} style={{ ...flexBetween, borderRadius: 12, background: '#F8FAFC', padding: 12, marginBottom: 10 }}>
                    <div style={{ ...flex, gap: 10 }}><Avatar name={p.name} size={32} />
                      <div><p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{p.name}</p>
                        <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{next ? `Follow-up: ${next}` : 'Contacted — needs follow-up'}</p></div>
                    </div>
                    {canManageOutreach(role) && <Button variant="sm" onClick={() => setSelectedPatient(p)}>Follow up</Button>}
                  </div>
                )
              })}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════════════════════════════
function AdminSettingsView({ trial, patients, running, handleRunAI, setPage, session, onRoleChange }: {
  trial: Trial; patients: Patient[]; running: boolean; handleRunAI: () => void; setPage: (p: Page) => void
  session: DemoUser; onRoleChange: (u: DemoUser) => void
}) {
  const [aiEnabled, setAiEnabled] = useState(true)
  const [autoStage, setAutoStage] = useState(true)
  const [notifyEmail, setNotifyEmail] = useState(true)
  const row: CSSProperties = { ...flexBetween, borderBottom: '1px solid #F8FAFC', padding: '10px 0', fontSize: 14 }
  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ ...flexBetween, marginBottom: 12, cursor: 'pointer' }}>
      <span style={{ fontSize: 14, color: C.text }}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        style={{ width: 44, height: 24, borderRadius: 999, border: 'none', background: checked ? C.blue : '#CBD5E1', position: 'relative', cursor: 'pointer' }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </button>
    </label>
  )
  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Card><CardHeader><span style={{ fontWeight: 700 }}>Active trial</span></CardHeader><CardBody>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Protocol</span><span>{trial.protocolId}</span></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Title</span><span>{trial.title}</span></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Phase</span><span>{trial.phase}</span></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Target</span><span>{trial.condition}</span></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Enrollment goal</span><span>{trial.enrollmentGoal}</span></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Status</span><TrialStatusBadge status={trial.archived ? 'Archived' : trial.recruitmentStatus} /></div>
          <div style={row}><span style={{ fontWeight: 600, color: C.muted }}>Protocol criteria</span><span>{trial.protocolCriteria ? 'Synced from documents' : 'Not parsed'}</span></div>
          <div style={{ ...flex, gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setPage('trials')}>Manage trials →</Button>
            <Button variant="secondary" onClick={() => setPage('documents')}>📁 Document center →</Button>
          </div>
        </CardBody></Card>
        <Card><CardHeader><span style={{ fontWeight: 700 }}>AI engine controls</span></CardHeader><CardBody>
          {toggle('AI matching enabled', aiEnabled, setAiEnabled)}
          {toggle('Auto-recommend stages after AI run', autoStage, setAutoStage)}
          <p style={{ margin: '12px 0', fontSize: 12, color: C.muted }}>{patients.length} patients in cohort</p>
          <Button loading={running} onClick={handleRunAI} disabled={!aiEnabled}>Run AI matching now</Button>
        </CardBody></Card>
        <Card><CardHeader><span style={{ fontWeight: 700 }}>User management (demo)</span></CardHeader><CardBody>
          {DEMO_USERS.map((u) => {
            const m = ROLE_META[u.role]
            return (
              <div key={u.id} style={{ ...flexBetween, borderRadius: 12, background: '#F8FAFC', padding: 12, marginBottom: 10 }}>
                <div style={{ ...flex, gap: 10 }}><Avatar name={u.name} size={32} />
                  <div><p style={{ margin: 0, fontWeight: 600 }}>{u.name}</p><p style={{ margin: 0, fontSize: 12, color: C.muted }}>{u.email}</p></div>
                </div>
                <span style={{ borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, background: m.bg, color: m.color }}>{m.label}</span>
              </div>
            )
          })}
          <p style={{ margin: '12px 0 0', fontSize: 11, color: C.slate }}>Connect auth API for production user management.</p>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: C.muted }}>Demo: switch role</p>
            <select
              value={session.id}
              onChange={(e) => { const u = DEMO_USERS.find((x) => x.id === e.target.value); if (u) onRoleChange(u) }}
              style={{ width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit' }}
            >
              {DEMO_USERS.map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {ROLE_META[u.role].label}</option>
              ))}
            </select>
          </div>
        </CardBody></Card>
        <Card><CardHeader><span style={{ fontWeight: 700 }}>System</span></CardHeader><CardBody>
          {toggle('Email notifications for stage changes', notifyEmail, setNotifyEmail)}
          {toggle('Activity audit log', true, () => {})}
          <div style={{ ...flex, gap: 12, marginTop: 16 }}>
            <Button variant="secondary">Export patients (CSV)</Button>
            <Button variant="secondary">Sync EHR (mock)</Button>
          </div>
        </CardBody></Card>
      </div>
    </div>
  )
}

function RecruiterActivityFeed({ patients }: { patients: Patient[] }) {
  const events = useMemo(() =>
    patients.flatMap((p) => p.activityLog.map((a) => ({ ...a, patientName: p.name, patientId: p.id })))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 8), [patients])
  if (events.length === 0) return <EmptyState title="No recent activity" />
  const icons: Record<string, string> = { ai: '🤖', outreach: '📤', stage: '🔄', note: '📝', flag: '🚩' }
  return (
    <div>
      {events.map((e) => (
        <div key={e.id + e.patientId} style={{ ...flex, gap: 12, padding: '10px 0', borderBottom: '1px solid #F8FAFC' }}>
          <span style={{ fontSize: 18 }}>{icons[e.type] ?? '•'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{e.patientName}</p>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.message}</p>
          </div>
          <span style={{ fontSize: 10, color: C.slate, flexShrink: 0 }}>{new Date(e.timestamp).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════
function AnalyticsView({ patients, trial }: { patients: Patient[]; trial: Trial }) {
  const total = patients.length
  const consented = patients.filter((p) => p.stage === 'Consented').length
  const contacted = patients.filter((p) => ['Contacted', 'Interested', 'Consented'].includes(p.stage)).length
  const interested = patients.filter((p) => ['Interested', 'Consented'].includes(p.stage)).length
  const aiMatched = patients.filter((p) => p.eligibilityScore >= 70).length
  const convRate = total > 0 ? Math.round((consented / total) * 100) : 0
  const outreachTotal = patients.reduce((s, p) => s + p.outreach.length, 0)
  const responded = patients.flatMap((p) => p.outreach).filter((o) => o.status === 'responded').length
  const outreachRate = outreachTotal > 0 ? Math.round((responded / outreachTotal) * 100) : 0
  const predictedEnrollment = Math.min(trial.enrollmentTarget, consented + Math.round(aiMatched * 0.15))
  const condFreq: Record<string, number> = {}
  patients.forEach((p) => { condFreq[p.diagnosis] = (condFreq[p.diagnosis] || 0) + 1 })
  const topConds = Object.entries(condFreq).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const recruiterPerf = [{ name: 'Lisa Park', contacted: 12, consented: 3 }, { name: 'Dr. Sarah Chen', contacted: 8, consented: 2 }]
  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg, padding: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
        {[{ label: 'Total patients', value: total, icon: '👥', border: C.blue }, { label: 'AI matched (≥70)', value: aiMatched, icon: '🤖', border: C.purple },
          { label: 'Contacted', value: contacted, icon: '📞', border: '#D97706' }, { label: 'Interested', value: interested, icon: '💬', border: C.teal },
          { label: 'Consented', value: consented, icon: '📋', border: '#059669' }, { label: 'Conversion', value: `${convRate}%`, icon: '📈', border: '#4F46E5' }].map((item) => (
          <Card key={item.label} style={{ borderTop: `4px solid ${item.border}` }}><CardBody style={{ padding: 16 }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>{item.value}</p>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{item.label}</p>
          </CardBody></Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Conversion funnel</h3>
          {STAGES.map((s) => {
            const count = patients.filter((p) => p.stage === s).length
            const pct = total > 0 ? (count / total) * 100 : 0
            const m = STAGE_META[s]
            return (
              <div key={s} style={{ marginBottom: 12 }}>
                <div style={{ ...flexBetween, fontSize: 14, marginBottom: 4 }}><span style={{ fontWeight: 600, color: m.color }}>{m.icon} {s}</span><strong>{count} ({pct.toFixed(0)}%)</strong></div>
                <div style={{ height: 10, borderRadius: 5, background: '#E2E8F0', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 5, background: C.blue, width: `${pct}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )
          })}
        </CardBody></Card>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Enrollment prediction</h3>
          <div style={{ ...flex, alignItems: 'center', gap: 24 }}>
            <ScoreRing score={Math.round((consented / trial.enrollmentTarget) * 100)} size={72} />
            <div>
              <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#047857' }}>{consented}<span style={{ fontSize: 18, fontWeight: 400, color: C.muted }}>/{trial.enrollmentTarget}</span></p>
              <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Current enrollment</p>
              <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 600, color: C.purple }}>AI forecast: ~{predictedEnrollment} by quarter end</p>
            </div>
          </div>
          <div style={{ marginTop: 16 }}><ProgressBar value={consented} max={trial.enrollmentTarget} color="#059669" /></div>
        </CardBody></Card>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Outreach success rate</h3>
          <p style={{ margin: 0, fontSize: 36, fontWeight: 800, color: C.teal }}>{outreachRate}%</p>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{responded} responded of {outreachTotal} messages sent</p>
          <div style={{ marginTop: 16 }}>{['sent', 'delivered', 'opened', 'responded'].map((st) => {
            const c = patients.flatMap((p) => p.outreach).filter((o) => o.status === st).length
            return <div key={st} style={{ ...flexBetween, fontSize: 14, marginBottom: 8, textTransform: 'capitalize' }}><span>{st}</span><strong>{c}</strong></div>
          })}</div>
        </CardBody></Card>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>AI match performance</h3>
          {[['High (75–100)', patients.filter((p) => p.eligibilityScore >= 75).length, '#059669'], ['Medium (50–74)', patients.filter((p) => p.eligibilityScore >= 50 && p.eligibilityScore < 75).length, '#D97706'], ['Low (<50)', patients.filter((p) => p.eligibilityScore < 50).length, '#DC2626']].map(([label, count, color]) => (
            <div key={label as string} style={{ marginBottom: 12 }}>
              <div style={{ ...flexBetween, fontSize: 14, marginBottom: 4 }}><span>{label}</span><strong>{count as number}</strong></div>
              <ProgressBar value={count as number} max={total} color={color as string} />
            </div>
          ))}
        </CardBody></Card>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Top diagnoses</h3>
          {topConds.map(([cond, cnt]) => (
            <div key={cond} style={{ marginBottom: 8 }}>
              <div style={{ ...flexBetween, fontSize: 14 }}><span>{cond}</span><span style={{ color: C.muted }}>{cnt} patients</span></div>
              <ProgressBar value={cnt} max={total} color={C.blue} />
            </div>
          ))}
        </CardBody></Card>
        <Card><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Recruiter performance</h3>
          {recruiterPerf.map((r) => (
            <div key={r.name} style={{ borderRadius: 12, background: '#F8FAFC', padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{r.name}</p>
              <div style={{ ...flex, gap: 16, marginTop: 4, fontSize: 12, color: C.muted }}><span>Contacted: {r.contacted}</span><span>Consented: {r.consented}</span></div>
            </div>
          ))}
        </CardBody></Card>
        <Card style={{ gridColumn: '1 / -1' }}><CardBody>
          <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Risk flag summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {(['high', 'medium', 'low'] as RiskLevel[]).map((level) => {
              const cnt = patients.filter((p) => p.riskFlags.some((f) => f.level === level)).length
              const m = RISK_META[level]
              return (
                <div key={level} style={{ borderRadius: 12, border: `1px solid ${m.border}`, background: m.bg, padding: 16 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, textTransform: 'capitalize', color: m.text }}>{level} risk</p>
                  <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: m.text }}>{cnt}</p>
                </div>
              )
            })}
            <div style={{ borderRadius: 12, border: '1px solid #A7F3D0', background: '#ECFDF5', padding: 16 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#047857' }}>No flags</p>
              <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: '#047857' }}>{patients.filter((p) => p.riskFlags.length === 0).length}</p>
            </div>
          </div>
        </CardBody></Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function DashboardView({ session, patients, trial, running, handleRunAI, setDetailPatient, setPage }: {
  session: DemoUser; patients: Patient[]; trial: Trial; running: boolean; handleRunAI: () => void
  setDetailPatient: (p: Patient) => void; setPage: (p: Page) => void
}) {
  const stats = useMemo(() => {
    const contacted = patients.filter((p) => ['Contacted', 'Interested', 'Consented'].includes(p.stage)).length
    const interested = patients.filter((p) => ['Interested', 'Consented'].includes(p.stage)).length
    const consented = patients.filter((p) => p.stage === 'Consented').length
    const aiMatches = patients.filter((p) => p.eligibilityScore >= 70).length
    return { contacted, interested, consented, aiMatches }
  }, [patients])
  const top5 = [...patients].sort((a, b) => b.eligibilityScore - a.eligibilityScore).slice(0, 5)
  const maxStage = Math.max(...STAGES.map((s) => patients.filter((p) => p.stage === s).length), 1)
  const kpis = [
    { label: 'Total Patients', value: patients.length, icon: '👥', color: C.blue, border: C.blue },
    { label: 'AI Matches', value: stats.aiMatches, icon: '🤖', color: C.purple, border: C.purple },
    { label: 'Contacted', value: stats.contacted, icon: '📞', color: '#D97706', border: '#D97706' },
    { label: 'Interested', value: stats.interested, icon: '💬', color: C.teal, border: C.teal },
    { label: 'Consented', value: stats.consented, icon: '📋', color: '#059669', border: '#059669' },
  ]
  return (
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', background: C.bg }}>
      <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.blue}, ${C.teal})`, padding: '24px 24px 32px' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.65)' }}>AI Patient Recruitment Intelligence</p>
        <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800, color: '#fff' }}>{trial.title} — {trial.phase}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>{trial.sponsor} · {trial.condition} · Ages {trial.ageRange.min}–{trial.ageRange.max}</p>
        <div style={{ ...flex, flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          {canRunAI(session.role) && <Button style={{ border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.2)' }} loading={running} onClick={handleRunAI}>🤖 Run AI Matching</Button>}
          <Button variant="secondary" style={{ borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={() => setPage('documents')}>📁 Document Center</Button>
          <Button variant="secondary" style={{ borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.1)', color: '#fff' }} onClick={() => setPage('pipeline')}>View Pipeline →</Button>
        </div>
      </div>
      <div style={{ padding: '0 24px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: -24, marginBottom: 24 }}>
          {kpis.map((k) => (
            <Card key={k.label} style={{ borderLeft: `4px solid ${k.border}` }}><CardBody style={{ padding: 16 }}>
              <span style={{ fontSize: 20 }}>{k.icon}</span>
              <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800, color: k.color }}>{k.value}</p>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{k.label}</p>
            </CardBody></Card>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <Card>
            <CardHeader style={flexBetween}><span style={{ fontWeight: 700 }}>🏆 Top AI candidates</span><Button variant="sm" onClick={() => setPage('patients')}>View all →</Button></CardHeader>
            {top5.map((p, i) => (
              <button key={p.id} type="button" onClick={() => setDetailPatient(p)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, border: 'none', borderBottom: '1px solid #F8FAFC', padding: '12px 20px', textAlign: 'left', cursor: 'pointer', background: C.white }}>
                <span style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: i < 3 ? '#059669' : C.slate }}>#{i + 1}</span>
                <Avatar name={p.name} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.name}</p><p style={{ margin: 0, fontSize: 12, color: C.muted }}>{p.diagnosis} · Age {p.age}</p><AIReasonPreview patient={p} max={2} /></div>
                <ScoreRing score={p.eligibilityScore} size={40} /><StageBadge stage={p.stage} />
              </button>
            ))}
          </Card>
          <Card><CardBody>
            <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Recruitment funnel</h3>
            {STAGES.map((stage) => {
              const count = patients.filter((p) => p.stage === stage).length
              const m = STAGE_META[stage]
              const pct = patients.length ? (count / patients.length) * 100 : 0
              return (
                <button key={stage} type="button" onClick={() => setPage('pipeline')} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, border: 'none', borderRadius: 12, padding: '8px 12px', marginBottom: 8, cursor: 'pointer', background: 'transparent' }}>
                  <span>{m.icon}</span><span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 600, color: m.color }}>{stage}</span>
                  <div style={{ width: 96 }}><ProgressBar value={count} max={maxStage} color={C.blue} /></div>
                  <span style={{ minWidth: 48, textAlign: 'right', fontSize: 14, fontWeight: 700, color: m.color }}>{count} ({pct.toFixed(0)}%)</span>
                </button>
              )
            })}
            <div style={{ marginTop: 16, borderRadius: 12, border: '1px solid #A7F3D0', background: '#ECFDF5', padding: 12 }}>
              <div style={{ ...flexBetween, fontSize: 12, fontWeight: 700, color: '#047857', marginBottom: 8 }}><span>Enrollment progress</span><span>{stats.consented}/{trial.enrollmentTarget}</span></div>
              <ProgressBar value={stats.consented} max={trial.enrollmentTarget} color="#059669" />
            </div>
          </CardBody></Card>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
          <Card><CardHeader><span style={{ fontWeight: 700 }}>AI recruitment performance</span></CardHeader><CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[{ label: 'Avg eligibility', value: `${Math.round(patients.reduce((s, p) => s + p.eligibilityScore, 0) / patients.length)}%` },
                { label: 'High confidence', value: patients.filter((p) => p.aiConfidence >= 80).length },
                { label: 'Flagged patients', value: patients.filter((p) => p.flagged).length }].map((m) => (
                <div key={m.label} style={{ borderRadius: 12, background: '#F8FAFC', padding: 16, textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.blue }}>{m.value}</p>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.muted }}>{m.label}</p>
                </div>
              ))}
            </div>
            <Button variant="secondary" style={{ marginTop: 16 }} onClick={() => setPage('analytics')}>View full analytics →</Button>
          </CardBody></Card>
          <Card><CardHeader><span style={{ fontWeight: 700 }}>Recruiter activity</span></CardHeader><CardBody>
            <RecruiterActivityFeed patients={patients} />
          </CardBody></Card>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════
function Sidebar({ page, setPage, role }: {
  page: Page; setPage: (p: Page) => void; role: Role
}) {
  const m = ROLE_META[role]
  const nav = NAV_ITEMS.filter((n) => canAccessPage(role, n.id))
  return (
    <aside style={{ ...flexCol, width: 224, flexShrink: 0, background: C.navy, minHeight: '100vh' }}>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '20px 16px' }}>
        <div style={{ ...flex, gap: 8, marginBottom: 12 }}>
          <div style={{ ...flexCenter, width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.15)', fontSize: 18 }}>🧬</div>
          <div style={{ color: '#fff' }}><p style={{ margin: 0, fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>RecruitAI</p><p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>Recruitment Platform</p></div>
        </div>
        <span style={{ display: 'inline-block', borderRadius: 999, padding: '2px 10px', fontSize: 10, fontWeight: 700, background: m.bg, color: m.color }}>{m.label}</span>
      </div>
      <nav style={{ flex: 1, padding: '16px 12px' }}>
        {nav.map((n) => {
          const active = page === n.id
          return (
            <button key={n.id} type="button" onClick={() => setPage(n.id)} style={{
              display: 'flex', width: '100%', alignItems: 'center', gap: 12, border: 'none', borderRadius: 12,
              padding: '10px 12px', marginBottom: 4, textAlign: 'left', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent', color: active ? '#fff' : 'rgba(255,255,255,0.6)',
              fontWeight: active ? 700 : 400,
            }}>
              <span style={{ fontSize: 16 }}>{n.icon}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SESSION IDLE WARNING
// ═══════════════════════════════════════════════════════════════════
function IdleSessionWarning({ secondsLeft, onStaySignedIn }: { secondsLeft: number; onStaySignedIn: () => void }) {
  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeLabel = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`

  return (
    <Modal title="Session expiring" onClose={onStaySignedIn}>
      <p style={{ margin: '0 0 12px', fontSize: 14, color: C.text, lineHeight: 1.5 }}>
        You have been inactive. For security, you will be signed out in <strong>{timeLabel}</strong>.
      </p>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: C.muted }}>
        Move your mouse, click, or press a key to stay signed in — or use the button below.
      </p>
      <div style={{ ...flex, justifyContent: 'flex-end', gap: 10 }}>
        <Button onClick={onStaySignedIn}>Stay signed in</Button>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════
type LoginView = 'signin' | 'forgot' | 'reset'

function LoginScreen({ onLogin, loading }: { onLogin: (email: string, password: string) => Promise<void>; loading?: boolean }) {
  const [view, setView] = useState<LoginView>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const inp: CSSProperties = {
    width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '12px 14px',
    fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
  }
  const lbl: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.muted }
  const linkBtn: CSSProperties = {
    background: 'none', border: 'none', padding: 0, color: C.blue, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'right' as const,
  }

  const clearMessages = () => { setError(null); setInfo(null) }

  const submitSignIn = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your username and password')
      return
    }
    clearMessages()
    setSubmitting(true)
    try {
      await onLogin(email.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed')
    }
    setSubmitting(false)
  }

  const submitForgot = async () => {
    if (!email.trim()) {
      setError('Please enter your username (email)')
      return
    }
    clearMessages()
    setSubmitting(true)
    try {
      const res = await api.forgotPassword(email.trim())
      setInfo(res.message)
      if (res.resetCode) {
        setDemoCode(res.resetCode)
        setResetCode(res.resetCode)
      }
      setView('reset')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reset code')
    }
    setSubmitting(false)
  }

  const submitReset = async () => {
    if (!email.trim() || !resetCode.trim() || !newPassword) {
      setError('Please fill in all fields')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    clearMessages()
    setSubmitting(true)
    try {
      const res = await api.resetPassword(email.trim(), resetCode.trim(), newPassword)
      setInfo(res.message)
      setPassword('')
      setResetCode('')
      setNewPassword('')
      setConfirmPassword('')
      setDemoCode(null)
      setView('signin')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset password')
    }
    setSubmitting(false)
  }

  const titles: Record<LoginView, { title: string; subtitle: string }> = {
    signin: { title: 'RecruitAI Platform', subtitle: 'Sign in to your account' },
    forgot: { title: 'Forgot password', subtitle: 'Enter your username to receive a reset code' },
    reset: { title: 'Reset password', subtitle: 'Enter the code and choose a new password' },
  }
  const header = titles[view]

  return (
    <div style={{ ...flexCenter, minHeight: '100vh', background: `linear-gradient(135deg, ${C.navy}, ${C.blue}, ${C.teal})`, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400, borderRadius: 24, background: C.white, padding: '36px 32px', boxShadow: C.elevated }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ ...flexCenter, width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px', background: `linear-gradient(135deg, ${C.navy}, ${C.blue}, ${C.teal})`, fontSize: 28 }}>🧬</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.text }}>{header.title}</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: C.muted }}>{header.subtitle}</p>
        </div>

        {view === 'signin' && (
          <form onSubmit={(e) => { e.preventDefault(); void submitSignIn() }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={lbl} htmlFor="login-username">Username</label>
              <input id="login-username" type="text" autoComplete="username" placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
            </div>
            <div>
              <div style={{ ...flexBetween, marginBottom: 6 }}>
                <label style={{ ...lbl, marginBottom: 0 }} htmlFor="login-password">Password</label>
                <button type="button" style={linkBtn} onClick={() => { clearMessages(); setView('forgot') }}>Forgot password?</button>
              </div>
              <input id="login-password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
            </div>
            {error && <div style={{ borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', fontSize: 13, color: '#B91C1C' }}>{error}</div>}
            {info && <div style={{ borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '10px 12px', fontSize: 13, color: '#047857' }}>{info}</div>}
            <Button style={{ width: '100%', justifyContent: 'center', padding: '13px 0' }} disabled={submitting || loading} onClick={() => void submitSignIn()}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {view === 'forgot' && (
          <form onSubmit={(e) => { e.preventDefault(); void submitForgot() }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={lbl} htmlFor="forgot-email">Username</label>
              <input id="forgot-email" type="text" autoComplete="username" placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
            </div>
            {error && <div style={{ borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', fontSize: 13, color: '#B91C1C' }}>{error}</div>}
            <Button style={{ width: '100%', justifyContent: 'center', padding: '13px 0' }} disabled={submitting} onClick={() => void submitForgot()}>
              {submitting ? 'Sending…' : 'Send reset code'}
            </Button>
            <button type="button" style={{ ...linkBtn, textAlign: 'center', width: '100%' }} onClick={() => { clearMessages(); setView('signin') }}>← Back to sign in</button>
          </form>
        )}

        {view === 'reset' && (
          <form onSubmit={(e) => { e.preventDefault(); void submitReset() }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {demoCode && (
              <div style={{ borderRadius: 10, background: '#EFF6FF', border: `1px solid ${C.blue}`, padding: '12px 14px', fontSize: 13, color: '#1E40AF' }}>
                <strong>Demo reset code:</strong> <span style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }}>{demoCode}</span>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: C.muted }}>In production this would be emailed to you. Code expires in 15 minutes.</p>
              </div>
            )}
            <div>
              <label style={lbl} htmlFor="reset-email">Username</label>
              <input id="reset-email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl} htmlFor="reset-code">Reset code</label>
              <input id="reset-code" type="text" inputMode="numeric" placeholder="6-digit code" value={resetCode} onChange={(e) => setResetCode(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl} htmlFor="reset-new">New password</label>
              <input id="reset-new" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl} htmlFor="reset-confirm">Confirm password</label>
              <input id="reset-confirm" type="password" autoComplete="new-password" placeholder="Re-enter new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inp} />
            </div>
            {error && <div style={{ borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', fontSize: 13, color: '#B91C1C' }}>{error}</div>}
            {info && !demoCode && <div style={{ borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '10px 12px', fontSize: 13, color: '#047857' }}>{info}</div>}
            <Button style={{ width: '100%', justifyContent: 'center', padding: '13px 0' }} disabled={submitting} onClick={() => void submitReset()}>
              {submitting ? 'Updating…' : 'Reset password'}
            </Button>
            <button type="button" style={{ ...linkBtn, textAlign: 'center', width: '100%' }} onClick={() => { clearMessages(); setView('signin') }}>← Back to sign in</button>
          </form>
        )}

        {view === 'signin' && (
          <p style={{ margin: '20px 0 0', fontSize: 12, color: C.slate, textAlign: 'center', lineHeight: 1.5 }}>
            Use the email and password provided by your organization administrator.
          </p>
        )}
      </div>
    </div>
  )
}

const NOTIF_ICONS: Record<NotifType, string> = { ai: '🤖', outreach: '📤', stage: '🔄', system: '🔔' }

const headerFieldLabel: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, lineHeight: '12px', height: 12 }
const headerFieldCaption: CSSProperties = { fontSize: 11, color: C.muted, lineHeight: '14px', minHeight: 14, display: 'block' }

const RECENT_TRIALS_KEY = 'recruit-ai-recent-trials'

function loadRecentTrialIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_TRIALS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

function pushRecentTrialId(id: string): string[] {
  const next = [id, ...loadRecentTrialIds().filter((x) => x !== id)].slice(0, 8)
  try { localStorage.setItem(RECENT_TRIALS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

function HeaderField({ label, caption, children, minWidth = 200, maxWidth = 300 }: { label: string; caption?: string; children: ReactNode; minWidth?: number; maxWidth?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth, maxWidth, flexShrink: 0 }}>
      <span style={headerFieldLabel}>{label}</span>
      <div style={{ height: 42, display: 'flex', alignItems: 'stretch' }}>{children}</div>
      <span style={headerFieldCaption}>{caption ?? '\u00A0'}</span>
    </div>
  )
}

function HeaderSelectWrap({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {icon && (
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, pointerEvents: 'none', zIndex: 1 }} aria-hidden>{icon}</span>
      )}
      {children}
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: C.muted, pointerEvents: 'none' }} aria-hidden>▼</span>
    </div>
  )
}

const headerSelectBase: CSSProperties = {
  width: '100%',
  height: 42,
  boxSizing: 'border-box',
  appearance: 'none',
  WebkitAppearance: 'none',
  borderRadius: 12,
  padding: '0 32px',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

type TrialStatusFilter = TrialRecruitmentStatus | 'all'

function trialMatchesSearch(t: Trial, q: string): boolean {
  if (!q) return true
  const hay = `${t.title} ${t.protocolId} ${t.condition} ${t.therapeuticArea} ${t.sponsor} ${t.phase}`.toLowerCase()
  return q.split(/\s+/).filter(Boolean).every((term) => hay.includes(term))
}

function TrialPicker({ trials, activeTrialId, recentTrialIds, onChange, onOpenTrials }: {
  trials: Trial[]
  activeTrialId: string
  recentTrialIds: string[]
  onChange: (id: string) => void
  onOpenTrials?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<TrialStatusFilter>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const active = trials.find((t) => t.id === activeTrialId)
  const visible = useMemo(() => trials.filter((t) => !t.archived), [trials])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visible
      .filter((t) => (statusFilter === 'all' || t.recruitmentStatus === statusFilter) && trialMatchesSearch(t, q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [visible, query, statusFilter])

  const recentTrials = useMemo(
    () => recentTrialIds.map((id) => visible.find((t) => t.id === id)).filter((t): t is Trial => !!t)
      .filter((t) => trialMatchesSearch(t, query.trim().toLowerCase()) && (statusFilter === 'all' || t.recruitmentStatus === statusFilter)),
    [recentTrialIds, visible, query, statusFilter],
  )

  const recentIds = new Set(recentTrials.map((t) => t.id))
  const listTrials = filtered.filter((t) => !recentIds.has(t.id))

  const statusFilters: { id: TrialStatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'Enrolling', label: 'Enrolling' },
    { id: 'Recruiting', label: 'Recruiting' },
    { id: 'Planned', label: 'Planned' },
    { id: 'Paused', label: 'Paused' },
  ]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
    setStatusFilter('all')
  }

  const renderRow = (t: Trial) => {
    const selected = t.id === activeTrialId
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => pick(t.id)}
        style={{
          display: 'flex', width: '100%', gap: 10, alignItems: 'flex-start', border: 'none', borderRadius: 10,
          padding: '10px 12px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
          background: selected ? C.blueLight : 'transparent',
          borderBottom: `1px solid #F1F5F9`,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>{t.protocolId} · {t.condition}</p>
        </div>
        <div style={{ ...flexCol, alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <TrialStatusBadge status={t.recruitmentStatus} />
          {selected && <span style={{ fontSize: 10, fontWeight: 700, color: C.blue }}>✓ Active</span>}
        </div>
      </button>
    )
  }

  if (visible.length === 0) return null

  return (
    <HeaderField
      label="Active trial"
      caption={active ? `${active.condition} · ${active.phase}` : undefined}
      minWidth={260}
      maxWidth={320}
    >
      <div ref={rootRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Choose active trial"
          style={{
            ...headerSelectBase,
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 38, paddingRight: 28,
            border: `2px solid ${open ? C.teal : C.blue}`,
            background: C.blueLight,
            color: C.navy,
            boxShadow: open ? '0 4px 12px rgba(26, 86, 219, 0.15)' : '0 1px 6px rgba(26, 86, 219, 0.1)',
            textAlign: 'left',
          }}
        >
          <span style={{ position: 'absolute', left: 12, fontSize: 15 }} aria-hidden>🧪</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active ? `${active.title}` : 'Select trial'}
          </span>
          <span style={{ position: 'absolute', right: 10, fontSize: 9, color: C.muted }} aria-hidden>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="Trial list"
            style={{
              position: 'absolute', left: 0, top: 'calc(100% + 6px)', width: 380, maxWidth: 'min(380px, 92vw)',
              borderRadius: 14, border: `1px solid ${C.border}`, background: C.white, boxShadow: C.elevated,
              zIndex: 50, overflow: 'hidden',
            }}
          >
            <div style={{ padding: 12, borderBottom: `1px solid ${C.border}`, background: '#F8FAFC' }}>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.slate }}>🔍</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, protocol, condition, sponsor…"
                  style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `2px solid ${C.border}`,
                    padding: '9px 12px 9px 34px', fontSize: 13, fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {statusFilters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    style={{
                      borderRadius: 999, border: `1px solid ${statusFilter === f.id ? C.blue : C.border}`,
                      background: statusFilter === f.id ? C.blueLight : C.white,
                      color: statusFilter === f.id ? C.blue : C.muted,
                      padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted }}>
                {filtered.length} of {visible.length} trial{visible.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="scrollbar-thin" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ margin: 0, padding: 20, textAlign: 'center', fontSize: 13, color: C.slate }}>No trials match your search.</p>
              ) : (
                <>
                  {recentTrials.length > 0 && !query.trim() && (
                    <>
                      <p style={{ margin: 0, padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>Recent</p>
                      {recentTrials.map(renderRow)}
                    </>
                  )}
                  <p style={{ margin: 0, padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>
                    {recentTrials.length > 0 && !query.trim() ? 'All trials' : 'Results'}
                  </p>
                  {listTrials.map(renderRow)}
                </>
              )}
            </div>

            {onOpenTrials && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, background: '#F8FAFC' }}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onOpenTrials() }}
                  style={{
                    width: '100%', border: 'none', borderRadius: 10, background: 'transparent', padding: '8px 12px',
                    fontSize: 12, fontWeight: 600, color: C.blue, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  🧪 Open full trial management →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </HeaderField>
  )
}

function UserProfileMenu({ session, onSignOut, toast }: {
  session: DemoUser
  onSignOut: () => void
  toast: (msg: string, type?: Toast['type']) => void
}) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'profile' | 'language' | 'help' | 'guide' | null>(null)
  const [language, setLanguage] = useState('en')
  const rootRef = useRef<HTMLDivElement>(null)
  const roleMeta = ROLE_META[session.role]

  const menuItems = [
    { id: 'profile' as const, icon: '⚙️', label: 'Profile settings' },
    { id: 'language' as const, icon: '🌐', label: 'Language settings' },
    { id: 'help' as const, icon: '💬', label: 'Contact help' },
    { id: 'guide' as const, icon: '📖', label: 'User guide' },
  ]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openModal = (id: typeof menuItems[number]['id']) => {
    setOpen(false)
    setModal(id)
  }

  const inp: CSSProperties = { width: '100%', borderRadius: 12, border: `2px solid ${C.border}`, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.muted }

  return (
    <>
      {modal === 'profile' && (
        <Modal title="Profile settings" onClose={() => setModal(null)}>
          <label style={lbl}>Full name</label>
          <input style={{ ...inp, marginBottom: 12 }} value={session.name} readOnly />
          <label style={lbl}>Email</label>
          <input style={{ ...inp, marginBottom: 12 }} value={session.email} readOnly />
          <label style={lbl}>Role</label>
          <input style={{ ...inp, marginBottom: 16 }} value={roleMeta.label} readOnly />
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Connect your identity provider to edit profile details in production.</p>
          <div style={{ ...flex, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button onClick={() => { setModal(null); toast('Profile saved (demo)') }}>Save</Button>
          </div>
        </Modal>
      )}
      {modal === 'language' && (
        <Modal title="Language settings" onClose={() => setModal(null)}>
          <label style={lbl}>Display language</label>
          <select style={{ ...inp, marginBottom: 16, cursor: 'pointer' }} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
          </select>
          <div style={{ ...flex, justifyContent: 'flex-end' }}>
            <Button onClick={() => { setModal(null); toast('Language updated (demo)') }}>Apply</Button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="Contact help" onClose={() => setModal(null)}>
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, color: C.text }}>Recruitment support is available Monday–Friday, 8am–6pm.</p>
          <p style={{ margin: '0 0 8px', fontSize: 13 }}><strong>Email:</strong> support@recruit-ai.demo</p>
          <p style={{ margin: '0 0 16px', fontSize: 13 }}><strong>Phone:</strong> +1 (800) 555-0199</p>
          <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText('support@recruit-ai.demo'); toast('Support email copied') }}>Copy support email</Button>
        </Modal>
      )}
      {modal === 'guide' && (
        <Modal title="User guide" onClose={() => setModal(null)} wide>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: C.text }}>
            <li>Select your <strong>active trial</strong> from the header to scope all recruitment data.</li>
            <li>Upload protocols in <strong>Document Center</strong>, then parse and sync criteria to AI matching.</li>
            <li>Run <strong>AI Matching</strong> to score patients against protocol rules.</li>
            <li>Move candidates through the <strong>Recruitment Pipeline</strong> and track outreach.</li>
          </ul>
        </Modal>
      )}

      <HeaderField label="Account" caption={session.email} minWidth={200} maxWidth={240}>
        <div ref={rootRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="Account menu"
            style={{
              ...headerSelectBase,
              position: 'relative',
              display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 28,
              border: `2px solid ${open ? C.blue : C.border}`,
              background: open ? C.blueLight : C.white,
              color: C.text,
              textAlign: 'left',
            }}
          >
            <Avatar name={session.name} size={28} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name.split(' ').slice(-1).join(' ') || session.name}</span>
            </span>
            <span style={{ position: 'absolute', right: 10, fontSize: 9, color: C.muted }} aria-hidden>{open ? '▲' : '▼'}</span>
          </button>

          {open && (
            <div
              role="menu"
              style={{
                position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 220, borderRadius: 12,
                border: `1px solid ${C.border}`, background: C.white, boxShadow: C.elevated, zIndex: 50, overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, background: '#F8FAFC' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{session.name}</p>
                <span style={{ marginTop: 6, display: 'inline-block', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, background: roleMeta.bg, color: roleMeta.color }}>{roleMeta.label}</span>
              </div>
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => openModal(item.id)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 10, border: 'none',
                    padding: '11px 14px', fontSize: 13, fontWeight: 500, textAlign: 'left', cursor: 'pointer',
                    background: C.white, color: C.text, fontFamily: 'inherit', borderBottom: '1px solid #F8FAFC',
                  }}
                >
                  <span style={{ fontSize: 16 }} aria-hidden>{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onSignOut() }}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', gap: 10, border: 'none',
                  padding: '12px 14px', fontSize: 13, fontWeight: 600, textAlign: 'left', cursor: 'pointer',
                  background: '#FEF2F2', color: '#B91C1C', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 16 }} aria-hidden>🚪</span>
                Sign out
              </button>
            </div>
          )}
        </div>
      </HeaderField>
    </>
  )
}

const PAGE_TITLES: Record<Page, { title: string; subtitle?: string }> = {
  trials: { title: 'Trials', subtitle: 'Trial setup, sites, assignments, and recruitment status' },
  documents: { title: 'Document Center', subtitle: 'Protocol & reference files for the active trial' },
  dashboard: { title: 'Dashboard', subtitle: 'Recruitment overview & KPIs' },
  patients: { title: 'Patients', subtitle: 'View and manage patients for the active trial' },
  ai: { title: 'AI Matching', subtitle: 'Run AI scoring and review ranked matches' },
  pipeline: { title: 'Recruitment Pipeline', subtitle: 'Drag-and-drop Kanban workflow' },
  outreach: { title: 'Outreach', subtitle: 'Email, SMS, templates, and follow-up tracking' },
  analytics: { title: 'Analytics', subtitle: 'Funnel, outreach, and AI performance' },
  admin: { title: 'Admin Settings', subtitle: 'Trial config, AI controls, and user management' },
}

function TopBar({ page, session, notifs, onMarkAllRead, onMarkRead, actions, trials, activeTrialId, recentTrialIds, onTrialChange, onOpenTrials, onSignOut, toast }: {
  page: Page; session: DemoUser
  notifs: Notification[]; onMarkAllRead: () => void; onMarkRead: (id: string) => void; actions?: ReactNode
  trials: Trial[]; activeTrialId: string; recentTrialIds: string[]
  onTrialChange: (id: string) => void; onOpenTrials?: () => void; onSignOut: () => void
  toast: (msg: string, type?: Toast['type']) => void
}) {
  const [showNotifs, setShowNotifs] = useState(false)
  const unread = notifs.filter((n) => !n.read).length
  const meta = PAGE_TITLES[page]
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, ...flex, flexWrap: 'wrap', alignItems: 'flex-start', gap: 16, borderBottom: `1px solid ${C.border}`, background: C.white, padding: '12px 24px', boxShadow: C.cardShadow }}>
      <div style={{ flex: 1, minWidth: 180, paddingTop: 2 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.title}</h1>
        {meta.subtitle && <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{meta.subtitle}</p>}
      </div>
      <div style={{ ...flex, alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
        <TrialPicker trials={trials} activeTrialId={activeTrialId} recentTrialIds={recentTrialIds} onChange={onTrialChange} onOpenTrials={onOpenTrials} />
        <UserProfileMenu session={session} onSignOut={onSignOut} toast={toast} />
        {actions && <div style={{ display: 'flex', alignItems: 'center', height: 42, marginTop: 18 }}>{actions}</div>}
        <HeaderField label="Alerts" minWidth={72}>
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <button type="button" onClick={() => setShowNotifs((v) => !v)} style={{
              ...flex, alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', height: 42, boxSizing: 'border-box',
              borderRadius: 12, border: `2px solid ${showNotifs ? C.blue : C.border}`,
              fontSize: 18, cursor: 'pointer', background: showNotifs ? C.blueLight : C.white, fontFamily: 'inherit',
            }} aria-label="Notifications">🔔{unread > 0 && <span style={{ borderRadius: 999, background: '#EF4444', padding: '2px 6px', fontSize: 10, fontWeight: 700, color: '#fff' }}>{unread}</span>}</button>
        {showNotifs && (
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, width: 320, borderRadius: 16, border: `1px solid ${C.border}`, background: C.white, boxShadow: C.elevated, overflow: 'hidden', zIndex: 30 }}>
            <div style={{ ...flexBetween, padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontWeight: 700 }}>Notifications {unread > 0 && `(${unread})`}</span>
              <Button variant="sm" onClick={onMarkAllRead}>Mark all read</Button>
            </div>
            <div className="scrollbar-thin" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {notifs.map((n) => (
                <button key={n.id} type="button" onClick={() => onMarkRead(n.id)} style={{
                  display: 'flex', width: '100%', gap: 12, border: 'none', borderBottom: '1px solid #F8FAFC', padding: '12px 16px', textAlign: 'left', cursor: 'pointer',
                  background: !n.read ? 'rgba(235,240,255,0.5)' : C.white, fontFamily: 'inherit',
                }}>
                  <span style={{ fontSize: 18 }}>{NOTIF_ICONS[n.type]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: n.read ? 400 : 700 }}>{n.title}</p><p style={{ margin: 0, fontSize: 12, color: C.muted }}>{n.body}</p></div>
                  {!n.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.blue, flexShrink: 0, marginTop: 4 }} />}
                </button>
              ))}
            </div>
          </div>
        )}
          </div>
        </HeaderField>
      </div>
    </header>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState<DemoUser | null>(null)
  const [booting, setBooting] = useState(true)
  const [trials, setTrials] = useState<Trial[]>([])
  const [trialDocuments, setTrialDocuments] = useState<TrialDocument[]>(seedDocumentsWithParsedProtocol)
  const [activeTrialId, setActiveTrialId] = useState<string>('')
  const [recentTrialIds, setRecentTrialIds] = useState<string[]>(loadRecentTrialIds)
  const [orgUsers, setOrgUsers] = useState<DemoUser[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [idleWarning, setIdleWarning] = useState(false)
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(60)
  const [running, setRunning] = useState(false)
  const [detailPatient, setDetailPatient] = useState<Patient | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [notifs, setNotifs] = useState<Notification[]>([
    { id: 'n1', type: 'ai', title: 'AI matching complete', body: '7 patients scored. Top: James Carter (92%)', read: false, ts: TODAY },
    { id: 'n2', type: 'stage', title: 'David Park consented', body: 'Patient moved to Consented stage', read: false, ts: TODAY },
    { id: 'n3', type: 'outreach', title: 'Maria Santos responded', body: 'Email response received — patient very interested', read: true, ts: TODAY },
  ])

  useEffect(() => {
    if (detailPatient) setDetailPatient(patients.find((p) => p.id === detailPatient.id) ?? null)
  }, [patients]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session && !canAccessPage(session.role, page)) setPage('dashboard')
  }, [session, page])

  useEffect(() => {
    if (recentTrialIds.length === 0 && activeTrialId) setRecentTrialIds(pushRecentTrialId(activeTrialId))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((msg: string, type: Toast['type'] = 'ok') => {
    setToasts((ts) => [...ts, { id: Date.now() + Math.random(), msg, type }])
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), [])

  const loadAppData = useCallback(async () => {
    const [trialsRaw, patientsRaw, usersRaw] = await Promise.all([
      api.getTrials(true),
      api.getPatients(),
      api.getUsers(),
    ])
    const mappedTrials = trialsRaw.map(apiTrialToTrial)
    const mappedPatients = patientsRaw.map(apiPatientToPatient)
    const mappedUsers = usersRaw.map(apiUserToSession)
    setOrgUsersCache(mappedUsers)
    setOrgUsers(mappedUsers)
    setTrials(mappedTrials)
    setPatients(mappedPatients)
    setActiveTrialId((prev) => {
      if (prev && mappedTrials.some((t) => t.id === prev && !t.archived)) return prev
      return mappedTrials.find((t) => !t.archived)?.id ?? mappedTrials[0]?.id ?? ''
    })
  }, [])

  useEffect(() => {
    ;(async () => {
      const token = getStoredToken()
      if (!token) {
        setBooting(false)
        return
      }
      try {
        const user = await api.me()
        setSession(apiUserToSession(user))
        await loadAppData()
      } catch {
        setStoredToken(null)
      }
      setBooting(false)
    })()
  }, [loadAppData])

  const handleLogin = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    setStoredToken(res.accessToken)
    setSession(apiUserToSession(res.user))
    await loadAppData()
    toast(`Welcome, ${res.user.name.split(' ')[0]}!`)
  }, [loadAppData, toast])

  const handleSignOut = useCallback((reason: 'manual' | 'idle' = 'manual') => {
    setStoredToken(null)
    setSession(null)
    setTrials([])
    setPatients([])
    setActiveTrialId('')
    setDetailPatient(null)
    setIdleWarning(false)
    toast(reason === 'idle' ? 'Signed out due to inactivity' : 'Signed out', reason === 'idle' ? 'warn' : 'ok')
  }, [toast])

  const handleIdleTimeout = useCallback(() => {
    setIdleWarning(false)
    handleSignOut('idle')
  }, [handleSignOut])

  const handleIdleWarning = useCallback(() => {
    setIdleSecondsLeft(60)
    setIdleWarning(true)
  }, [])

  const { resetTimer: resetIdleTimer } = useIdleTimeout({
    enabled: !!session,
    timeoutMs: getSessionIdleTimeoutMs(),
    warningBeforeMs: 60 * 1000,
    onTimeout: handleIdleTimeout,
    onWarning: handleIdleWarning,
    onActivity: () => setIdleWarning(false),
  })

  const staySignedIn = useCallback(() => {
    setIdleWarning(false)
    resetIdleTimer()
  }, [resetIdleTimer])

  useEffect(() => {
    if (!idleWarning) return
    const id = window.setInterval(() => {
      setIdleSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [idleWarning])

  const syncPatient = useCallback(async (patient: Patient) => {
    try {
      const saved = await api.updatePatient(patient.id, patientToApiPayload(patient))
      const mapped = apiPatientToPatient(saved)
      setPatients((ps) => ps.map((p) => (p.id === mapped.id ? mapped : p)))
    } catch {
      toast('Failed to save patient — changes kept locally', 'warn')
    }
  }, [toast])

  const activeTrial = useMemo(() => {
    const t = trials.find((tr) => tr.id === activeTrialId && !tr.archived)
    return t ?? trials.find((tr) => !tr.archived) ?? trials[0]
  }, [trials, activeTrialId])

  const trialPatients = useMemo(
    () => (activeTrial ? patients.filter((p) => p.trialId === activeTrial.id) : []),
    [patients, activeTrial],
  )

  const saveTrial = useCallback(async (t: Trial) => {
    const exists = trials.some((x) => x.id === t.id)
    try {
      const payload = trialToApiPayload(syncTrialEnrollment(t))
      const saved = exists
        ? await api.updateTrial(t.id, payload)
        : await api.createTrial(payload)
      const mapped = apiTrialToTrial(saved)
      setTrials((ts) => (exists ? ts.map((x) => (x.id === t.id ? mapped : x)) : [...ts, mapped]))
      toast(exists ? 'Trial updated' : 'Trial created')
    } catch {
      toast('Failed to save trial', 'err')
    }
  }, [trials, toast])

  const handleSetActiveTrial = useCallback((id: string) => {
    setActiveTrialId(id)
    setRecentTrialIds(pushRecentTrialId(id))
    const t = trials.find((tr) => tr.id === id)
    toast(t ? `Active trial: ${t.title}` : 'Trial selected')
  }, [trials, toast])

  const docCountForTrial = useCallback((trialId: string) => trialDocuments.filter((d) => d.trialId === trialId).length, [trialDocuments])

  const uploadDocument = useCallback((trialId: string, meta: { title: string; category: DocCategory; fileName: string }) => {
    const doc: TrialDocument = {
      id: `doc-${Date.now()}`,
      trialId,
      title: meta.title,
      category: meta.category,
      fileName: meta.fileName,
      mimeType: meta.fileName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      currentVersion: 1,
      versions: [mkDocVersion(1, meta.fileName, session?.id ?? 'u1')],
      tags: [meta.category],
      contentPreview: `Uploaded ${meta.title} (${meta.fileName}). Add protocol text via AI parse for searchable recruitment criteria.`,
      uploadedBy: session?.id ?? 'u1',
      updatedAt: TODAY,
      expiryDate: meta.category === 'irb' || meta.category === 'consent_template' ? daysAgo(-365) : undefined,
    }
    setTrialDocuments((ds) => [doc, ...ds])
    toast(`Uploaded: ${meta.title}`)
  }, [session, toast])

  const addDocumentVersion = useCallback((docId: string, fileName: string) => {
    setTrialDocuments((ds) => ds.map((d) => {
      if (d.id !== docId) return d
      const nextVer = d.currentVersion + 1
      return {
        ...d,
        currentVersion: nextVer,
        fileName,
        versions: [...d.versions, mkDocVersion(nextVer, fileName, session?.id ?? 'u1', 'New version uploaded')],
        updatedAt: TODAY,
      }
    }))
    toast('New document version added')
  }, [session, toast])

  const parseDocument = useCallback(async (docId: string) => {
    await new Promise((r) => setTimeout(r, 1800))
    const doc = trialDocuments.find((d) => d.id === docId)
    if (!doc) return
    const trial = trials.find((t) => t.id === doc.trialId)
    if (!trial) return
    const criteria = parseProtocolFromDocument(trial, doc)
    setTrialDocuments((ds) => ds.map((d) => (d.id === docId ? { ...d, parsedCriteria: criteria, updatedAt: TODAY } : d)))
    toast('AI protocol parse complete — review and sync to trial')
  }, [trialDocuments, trials, toast])

  const applyCriteriaToTrialState = useCallback(async (trialId: string, criteria: ProtocolCriteriaExtract) => {
    try {
      await api.updateTrial(trialId, { protocolCriteria: criteria })
      setTrials((ts) => ts.map((t) => (t.id === trialId ? applyCriteriaToTrial(t, criteria) : t)))
      toast('Protocol criteria synced — AI matching & eligibility now use document rules')
      setNotifs((ns) => [{ id: 'n' + Date.now(), type: 'system', title: 'Protocol criteria updated', body: `Criteria from ${criteria.sourceDocTitle} applied to trial`, read: false, ts: TODAY }, ...ns])
    } catch {
      toast('Failed to sync protocol criteria', 'err')
    }
  }, [toast])

  const archiveTrial = useCallback(async (id: string) => {
    try {
      await api.updateTrial(id, { archived: true, recruitmentStatus: 'Archived' })
      setTrials((ts) => {
        const updated = ts.map((t) =>
          t.id === id ? { ...t, archived: true, recruitmentStatus: 'Archived' as TrialRecruitmentStatus, updatedAt: TODAY } : t,
        )
        if (activeTrialId === id) {
          const next = updated.find((t) => t.id !== id && !t.archived)
          if (next) setActiveTrialId(next.id)
        }
        return updated
      })
      toast('Trial archived', 'warn')
    } catch {
      toast('Failed to archive trial', 'err')
    }
  }, [activeTrialId, toast])

  const handleRunAI = useCallback(async () => {
    if (!activeTrial) return
    setRunning(true)
    await new Promise((r) => setTimeout(r, 2200))
    const n = trialPatients.length
    const updated = patients.map((p) => (p.trialId === activeTrial.id ? { ...p, ...runAIEngine(p, activeTrial) } : p))
    setPatients(updated)
    const trialUpdated = updated.filter((p) => p.trialId === activeTrial.id)
    await Promise.all(trialUpdated.map((p) => api.updatePatient(p.id, patientToApiPayload(p)).catch(() => null)))
    setNotifs((ns) => [{ id: 'n' + Date.now(), type: 'ai', title: 'AI analysis complete', body: `${n} patients re-scored for ${activeTrial.title}`, read: false, ts: TODAY }, ...ns])
    setRunning(false)
    toast('AI matching complete — all scores updated')
  }, [toast, trialPatients.length, activeTrial, patients])

  const stageChange = useCallback((pid: string, stage: RecruitStage) => {
    const patient = patients.find((p) => p.id === pid)
    if (!patient) return
    const updated: Patient = {
      ...patient,
      stage,
      activityLog: [{ id: `act-${Date.now()}`, type: 'stage', message: `Moved to ${stage}`, timestamp: new Date().toISOString() }, ...patient.activityLog],
    }
    setPatients((ps) => ps.map((p) => (p.id === pid ? updated : p)))
    void syncPatient(updated)
    toast(`${patient.name} moved to ${stage}`)
    setNotifs((ns) => [{ id: 'n' + Date.now(), type: 'stage', title: `Stage update: ${stage}`, body: `${patient.name} moved to ${stage}`, read: false, ts: TODAY }, ...ns])
  }, [patients, syncPatient, toast])

  const addNote = useCallback((pid: string, note: string) => {
    const patient = patients.find((p) => p.id === pid)
    if (!patient) return
    const updated: Patient = {
      ...patient,
      notes: [...patient.notes, note],
      activityLog: [{ id: `act-${Date.now()}`, type: 'note', message: 'Recruiter note added', timestamp: new Date().toISOString() }, ...patient.activityLog],
    }
    setPatients((ps) => ps.map((p) => (p.id === pid ? updated : p)))
    void syncPatient(updated)
    toast('Note saved')
  }, [patients, syncPatient, toast])

  const addOutreach = useCallback((pid: string, rec: OutreachRecord) => {
    const patient = patients.find((p) => p.id === pid)
    if (!patient) return
    const updated: Patient = {
      ...patient,
      outreach: [...patient.outreach, rec],
      lastContact: TODAY,
      stage: patient.stage === 'Identified' || patient.stage === 'Eligible' ? 'Contacted' : patient.stage,
      activityLog: [{ id: `act-${Date.now()}`, type: 'outreach', message: `${rec.channel} sent — ${rec.template}`, timestamp: new Date().toISOString() }, ...patient.activityLog],
    }
    setPatients((ps) => ps.map((p) => (p.id === pid ? updated : p)))
    void syncPatient(updated)
    toast(`${rec.channel} sent to ${patient.name}`)
    setNotifs((ns) => [{ id: 'n' + Date.now(), type: 'outreach', title: 'Outreach sent', body: `${rec.channel} sent — template: ${rec.template}`, read: false, ts: TODAY }, ...ns])
  }, [patients, syncPatient, toast])

  const toggleFlag = useCallback((pid: string) => {
    const patient = patients.find((p) => p.id === pid)
    if (!patient) return
    const updated: Patient = {
      ...patient,
      flagged: !patient.flagged,
      activityLog: [{ id: `act-${Date.now()}`, type: 'flag', message: patient.flagged ? 'Flag removed' : 'Patient flagged for review', timestamp: new Date().toISOString() }, ...patient.activityLog],
    }
    setPatients((ps) => ps.map((p) => (p.id === pid ? updated : p)))
    void syncPatient(updated)
    toast('Patient flag updated', 'warn')
  }, [patients, syncPatient, toast])

  const addPatients = useCallback(async (newPatients: Patient[]) => {
    if (newPatients.length === 0 || !activeTrial) return
    try {
      const saved = await api.createPatientsBulk(newPatients.map(patientToApiPayload))
      const mapped = saved.map(apiPatientToPatient)
      setPatients((ps) => [...ps, ...mapped])
      toast(`Added ${mapped.length} patient${mapped.length !== 1 ? 's' : ''} to ${activeTrial.title}`)
      setNotifs((ns) => [{
        id: 'n' + Date.now(),
        type: 'system',
        title: 'Patients imported',
        body: `${mapped.length} patient(s) added to ${activeTrial.protocolId}`,
        read: false,
        ts: TODAY,
      }, ...ns])
    } catch {
      toast('Failed to add patients', 'err')
    }
  }, [toast, activeTrial?.title, activeTrial?.protocolId])

  const detailTrial = useMemo(
    () => (detailPatient ? trials.find((t) => t.id === detailPatient.trialId) ?? activeTrial : activeTrial),
    [detailPatient, trials, activeTrial],
  )

  if (booting) {
    return (
      <div style={{ ...flexCenter, minHeight: '100vh', background: C.bg }}>
        <LoadingOverlay message="Connecting to RecruitAI API…" />
      </div>
    )
  }

  if (!session) {
    return (
      <>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <LoginScreen onLogin={handleLogin} loading={booting} />
      </>
    )
  }

  if (!activeTrial) {
    return (
      <>
        {idleWarning && <IdleSessionWarning secondsLeft={idleSecondsLeft} onStaySignedIn={staySignedIn} />}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <div style={{ ...flexCenter, minHeight: '100vh', background: C.bg, flexDirection: 'column', gap: 16 }}>
          <p style={{ color: C.muted }}>No trials available. Create a trial or check the API seed.</p>
          <Button onClick={() => handleSignOut()}>Sign out</Button>
        </div>
      </>
    )
  }

  if (detailPatient) {
    return (
      <>
        {idleWarning && <IdleSessionWarning secondsLeft={idleSecondsLeft} onStaySignedIn={staySignedIn} />}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <PatientDetailView patient={detailPatient} trial={detailTrial} session={session} onBack={() => setDetailPatient(null)}
          stageChange={stageChange} addNote={addNote} addOutreach={addOutreach} toggleFlag={toggleFlag}
          docCount={docCountForTrial(detailTrial.id)} />
      </>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {idleWarning && <IdleSessionWarning secondsLeft={idleSecondsLeft} onStaySignedIn={staySignedIn} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <Sidebar page={page} setPage={setPage} role={session.role} />
      <div style={{ ...flexCol, flex: 1, overflow: 'hidden' }}>
        <TopBar page={page} session={session} notifs={notifs} toast={toast}
          trials={trials} activeTrialId={activeTrialId} recentTrialIds={recentTrialIds} onTrialChange={handleSetActiveTrial}
          onOpenTrials={() => setPage('trials')} onSignOut={handleSignOut}
          onMarkAllRead={() => setNotifs((ns) => ns.map((n) => ({ ...n, read: true })))}
          onMarkRead={(id) => setNotifs((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)))} />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {page === 'trials' && (
            <TrialsView trials={trials} patients={patients} activeTrialId={activeTrialId} session={session}
              onSetActive={handleSetActiveTrial} onSaveTrial={saveTrial} onArchiveTrial={archiveTrial} setPage={setPage}
              docCountByTrial={docCountForTrial} users={orgUsers}
              stageChange={stageChange} setDetailPatient={setDetailPatient} addOutreach={addOutreach} />
          )}
          {page === 'documents' && (
            <ProtocolDocumentCenterView
              trial={activeTrial}
              documents={trialDocuments}
              session={session}
              onUpload={uploadDocument}
              onNewVersion={addDocumentVersion}
              onParse={parseDocument}
              onApplyCriteria={applyCriteriaToTrialState}
              setPage={setPage}
              toast={toast}
            />
          )}
          {page === 'dashboard' && <DashboardView session={session} patients={trialPatients} trial={activeTrial} running={running} handleRunAI={handleRunAI} setDetailPatient={setDetailPatient} setPage={setPage} />}
          {page === 'patients' && (
            <PatientListView
              patients={trialPatients}
              trial={activeTrial}
              allPatients={patients}
              setDetailPatient={setDetailPatient}
              onAddPatients={addPatients}
              canAdd={canAddPatients(session.role)}
              toast={toast}
            />
          )}
          {page === 'pipeline' && <KanbanView patients={trialPatients} role={session.role} stageChange={stageChange} setDetailPatient={setDetailPatient} addOutreach={addOutreach} />}
          {page === 'ai' && <AIMatchingView session={session} patients={trialPatients} trial={activeTrial} running={running} handleRunAI={handleRunAI}
            docCount={docCountForTrial(activeTrial.id)} setPage={setPage} />}
          {page === 'outreach' && <OutreachView patients={trialPatients} role={session.role} setDetailPatient={setDetailPatient} addOutreach={addOutreach} />}
          {page === 'analytics' && <AnalyticsView patients={trialPatients} trial={activeTrial} />}
          {page === 'admin' && canAdminSettings(session.role) && (
            <AdminSettingsView trial={activeTrial} patients={trialPatients} running={running} handleRunAI={handleRunAI} setPage={setPage}
              session={session} onRoleChange={(u) => { setSession(u); toast(`Switched to ${u.name}`) }} />
          )}
        </main>
      </div>
    </div>
  )
}
