import { Trial, Patient, User, Prisma } from '@prisma/client'

export type TrialWithRelations = Trial
export type PatientRecord = Patient
export type UserRecord = Omit<User, 'passwordHash'>

export function toApiUser(user: User): UserRecord {
  const { passwordHash: _, ...rest } = user
  return rest
}

export function toApiTrial(trial: Trial) {
  return {
    id: trial.id,
    title: trial.title,
    protocolId: trial.protocolId,
    sponsor: trial.sponsor,
    phase: trial.phase,
    therapeuticArea: trial.therapeuticArea,
    condition: trial.condition,
    description: trial.description,
    recruitmentTarget: trial.recruitmentTarget,
    enrollmentGoal: trial.enrollmentGoal,
    enrollmentTarget: trial.enrollmentTarget,
    recruitmentStatus: trial.recruitmentStatus,
    ageRange: { min: trial.ageMin, max: trial.ageMax },
    targetConditions: trial.targetConditions,
    sites: trial.sites as unknown[],
    startDate: trial.startDate.toISOString().slice(0, 10),
    endDate: trial.endDate.toISOString().slice(0, 10),
    ownerId: trial.ownerId,
    recruiterIds: trial.recruiterIds,
    archived: trial.archived,
    createdAt: trial.createdAt.toISOString(),
    updatedAt: trial.updatedAt.toISOString(),
    protocolCriteria: trial.protocolCriteria ?? undefined,
    protocolCriteriaUpdatedAt: trial.protocolCriteriaUpdatedAt?.toISOString(),
  }
}

export function toApiPatient(patient: Patient) {
  return {
    id: patient.externalId ?? patient.id,
    dbId: patient.id,
    trialId: patient.trialId,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    diagnosis: patient.diagnosis,
    condition: patient.condition,
    stage: patient.stage,
    eligibilityScore: patient.eligibilityScore,
    aiConfidence: patient.aiConfidence,
    riskLevel: patient.riskLevel,
    reasons: patient.reasons as unknown[],
    riskFlags: patient.riskFlags as unknown[],
    history: patient.history as unknown[],
    medications: patient.medications as unknown[],
    labResults: patient.labResults as unknown[],
    outreach: patient.outreach as unknown[],
    notes: patient.notes,
    activityLog: patient.activityLog as unknown[],
    flagged: patient.flagged,
    lastContact: patient.lastContact?.toISOString().slice(0, 10),
    tags: patient.tags,
    uploadedAt: patient.uploadedAt.toISOString().slice(0, 10),
  }
}

export type CreateTrialInput = {
  title: string
  protocolId: string
  sponsor: string
  phase: string
  therapeuticArea: string
  condition: string
  description: string
  recruitmentTarget: number
  enrollmentGoal: number
  recruitmentStatus: Trial['recruitmentStatus']
  ageRange: { min: number; max: number }
  targetConditions: string[]
  sites: unknown[]
  startDate: string
  endDate: string
  recruiterIds?: string[]
  archived?: boolean
  protocolCriteria?: unknown
}

export type UpdateTrialInput = Partial<CreateTrialInput> & { enrollmentTarget?: number }

export type CreatePatientInput = {
  trialId: string
  externalId?: string
  name: string
  age: number
  gender: string
  condition: string
  diagnosis?: string
  stage?: Patient['stage']
  eligibilityScore?: number
  aiConfidence?: number
  riskLevel?: Patient['riskLevel']
  reasons?: unknown[]
  riskFlags?: unknown[]
  history?: unknown[]
  medications?: unknown[]
  labResults?: unknown[]
  outreach?: unknown[]
  notes?: string[]
  activityLog?: unknown[]
  flagged?: boolean
  lastContact?: string
  tags?: string[]
  uploadedAt?: string
}

export type UpdatePatientInput = Partial<Omit<CreatePatientInput, 'trialId'>>

export function trialToPrismaCreate(data: CreateTrialInput, ownerId: string): Prisma.TrialCreateInput {
  return {
    title: data.title,
    protocolId: data.protocolId,
    sponsor: data.sponsor,
    phase: data.phase,
    therapeuticArea: data.therapeuticArea,
    condition: data.condition,
    description: data.description,
    recruitmentTarget: data.recruitmentTarget,
    enrollmentGoal: data.enrollmentGoal,
    enrollmentTarget: 0,
    recruitmentStatus: data.recruitmentStatus,
    ageMin: data.ageRange.min,
    ageMax: data.ageRange.max,
    targetConditions: data.targetConditions,
    sites: data.sites as Prisma.InputJsonValue,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    recruiterIds: data.recruiterIds ?? [],
    archived: data.archived ?? false,
    protocolCriteria: data.protocolCriteria as Prisma.InputJsonValue | undefined,
    owner: { connect: { id: ownerId } },
  }
}

export function trialToPrismaUpdate(data: UpdateTrialInput): Prisma.TrialUpdateInput {
  const update: Prisma.TrialUpdateInput = {}
  if (data.title !== undefined) update.title = data.title
  if (data.protocolId !== undefined) update.protocolId = data.protocolId
  if (data.sponsor !== undefined) update.sponsor = data.sponsor
  if (data.phase !== undefined) update.phase = data.phase
  if (data.therapeuticArea !== undefined) update.therapeuticArea = data.therapeuticArea
  if (data.condition !== undefined) update.condition = data.condition
  if (data.description !== undefined) update.description = data.description
  if (data.recruitmentTarget !== undefined) update.recruitmentTarget = data.recruitmentTarget
  if (data.enrollmentGoal !== undefined) update.enrollmentGoal = data.enrollmentGoal
  if (data.enrollmentTarget !== undefined) update.enrollmentTarget = data.enrollmentTarget
  if (data.recruitmentStatus !== undefined) update.recruitmentStatus = data.recruitmentStatus
  if (data.ageRange !== undefined) {
    update.ageMin = data.ageRange.min
    update.ageMax = data.ageRange.max
  }
  if (data.targetConditions !== undefined) update.targetConditions = data.targetConditions
  if (data.sites !== undefined) update.sites = data.sites as Prisma.InputJsonValue
  if (data.startDate !== undefined) update.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) update.endDate = new Date(data.endDate)
  if (data.recruiterIds !== undefined) update.recruiterIds = data.recruiterIds
  if (data.archived !== undefined) update.archived = data.archived
  if (data.protocolCriteria !== undefined) {
    update.protocolCriteria = data.protocolCriteria as Prisma.InputJsonValue
    update.protocolCriteriaUpdatedAt = new Date()
  }
  return update
}

export function patientToPrismaCreate(data: CreatePatientInput): Prisma.PatientCreateInput {
  return {
    externalId: data.externalId,
    trial: { connect: { id: data.trialId } },
    name: data.name,
    age: data.age,
    gender: data.gender,
    condition: data.condition,
    diagnosis: data.diagnosis ?? data.condition,
    stage: data.stage ?? 'Identified',
    eligibilityScore: data.eligibilityScore ?? 0,
    aiConfidence: data.aiConfidence ?? 0,
    riskLevel: data.riskLevel ?? 'low',
    reasons: (data.reasons ?? []) as Prisma.InputJsonValue,
    riskFlags: (data.riskFlags ?? []) as Prisma.InputJsonValue,
    history: (data.history ?? []) as Prisma.InputJsonValue,
    medications: (data.medications ?? []) as Prisma.InputJsonValue,
    labResults: (data.labResults ?? []) as Prisma.InputJsonValue,
    outreach: (data.outreach ?? []) as Prisma.InputJsonValue,
    notes: data.notes ?? [],
    activityLog: (data.activityLog ?? []) as Prisma.InputJsonValue,
    flagged: data.flagged ?? false,
    lastContact: data.lastContact ? new Date(data.lastContact) : undefined,
    tags: data.tags ?? [],
    uploadedAt: data.uploadedAt ? new Date(data.uploadedAt) : undefined,
  }
}

export function patientToPrismaUpdate(data: UpdatePatientInput): Prisma.PatientUpdateInput {
  const update: Prisma.PatientUpdateInput = {}
  if (data.externalId !== undefined) update.externalId = data.externalId
  if (data.name !== undefined) update.name = data.name
  if (data.age !== undefined) update.age = data.age
  if (data.gender !== undefined) update.gender = data.gender
  if (data.condition !== undefined) update.condition = data.condition
  if (data.diagnosis !== undefined) update.diagnosis = data.diagnosis
  if (data.stage !== undefined) update.stage = data.stage
  if (data.eligibilityScore !== undefined) update.eligibilityScore = data.eligibilityScore
  if (data.aiConfidence !== undefined) update.aiConfidence = data.aiConfidence
  if (data.riskLevel !== undefined) update.riskLevel = data.riskLevel
  if (data.reasons !== undefined) update.reasons = data.reasons as Prisma.InputJsonValue
  if (data.riskFlags !== undefined) update.riskFlags = data.riskFlags as Prisma.InputJsonValue
  if (data.history !== undefined) update.history = data.history as Prisma.InputJsonValue
  if (data.medications !== undefined) update.medications = data.medications as Prisma.InputJsonValue
  if (data.labResults !== undefined) update.labResults = data.labResults as Prisma.InputJsonValue
  if (data.outreach !== undefined) update.outreach = data.outreach as Prisma.InputJsonValue
  if (data.notes !== undefined) update.notes = data.notes
  if (data.activityLog !== undefined) update.activityLog = data.activityLog as Prisma.InputJsonValue
  if (data.flagged !== undefined) update.flagged = data.flagged
  if (data.lastContact !== undefined) update.lastContact = data.lastContact ? new Date(data.lastContact) : null
  if (data.tags !== undefined) update.tags = data.tags
  if (data.uploadedAt !== undefined) update.uploadedAt = new Date(data.uploadedAt)
  return update
}
