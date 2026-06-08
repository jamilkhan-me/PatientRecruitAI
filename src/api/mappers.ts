import type { Patient, Trial, DemoUser } from '../App'
import type { ApiUser } from './client'

export function apiUserToSession(user: ApiUser): DemoUser {
  return { id: user.id, name: user.name, role: user.role, email: user.email }
}

export function apiTrialToTrial(raw: Record<string, unknown>): Trial {
  const ageRange = raw.ageRange as { min: number; max: number } | undefined
  return {
    id: String(raw.id),
    title: String(raw.title),
    protocolId: String(raw.protocolId),
    sponsor: String(raw.sponsor),
    phase: String(raw.phase),
    therapeuticArea: String(raw.therapeuticArea),
    condition: String(raw.condition),
    description: String(raw.description),
    recruitmentTarget: Number(raw.recruitmentTarget),
    enrollmentGoal: Number(raw.enrollmentGoal),
    enrollmentTarget: Number(raw.enrollmentTarget ?? 0),
    recruitmentStatus: raw.recruitmentStatus as Trial['recruitmentStatus'],
    ageRange: ageRange ?? { min: 18, max: 99 },
    targetConditions: (raw.targetConditions as string[]) ?? [],
    sites: (raw.sites as Trial['sites']) ?? [],
    startDate: String(raw.startDate),
    endDate: String(raw.endDate),
    ownerId: String(raw.ownerId),
    recruiterIds: (raw.recruiterIds as string[]) ?? [],
    archived: Boolean(raw.archived),
    createdAt: String(raw.createdAt),
    updatedAt: String(raw.updatedAt),
    protocolCriteria: raw.protocolCriteria as Trial['protocolCriteria'],
    protocolCriteriaUpdatedAt: raw.protocolCriteriaUpdatedAt as string | undefined,
  }
}

export function trialToApiPayload(trial: Trial): Record<string, unknown> {
  return {
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
    ageRange: trial.ageRange,
    targetConditions: trial.targetConditions,
    sites: trial.sites,
    startDate: trial.startDate,
    endDate: trial.endDate,
    recruiterIds: trial.recruiterIds,
    archived: trial.archived,
    protocolCriteria: trial.protocolCriteria,
  }
}

export function apiPatientToPatient(raw: Record<string, unknown>): Patient {
  return {
    id: String(raw.id),
    trialId: String(raw.trialId),
    name: String(raw.name),
    age: Number(raw.age),
    gender: raw.gender as Patient['gender'],
    diagnosis: String(raw.diagnosis),
    condition: String(raw.condition),
    stage: raw.stage as Patient['stage'],
    eligibilityScore: Number(raw.eligibilityScore),
    aiConfidence: Number(raw.aiConfidence),
    riskLevel: raw.riskLevel as Patient['riskLevel'],
    reasons: (raw.reasons as Patient['reasons']) ?? [],
    riskFlags: (raw.riskFlags as Patient['riskFlags']) ?? [],
    history: (raw.history as Patient['history']) ?? [],
    medications: (raw.medications as Patient['medications']) ?? [],
    labResults: (raw.labResults as Patient['labResults']) ?? [],
    outreach: (raw.outreach as Patient['outreach']) ?? [],
    notes: (raw.notes as string[]) ?? [],
    activityLog: (raw.activityLog as Patient['activityLog']) ?? [],
    flagged: Boolean(raw.flagged),
    lastContact: raw.lastContact as string | undefined,
    tags: (raw.tags as string[]) ?? [],
    uploadedAt: String(raw.uploadedAt),
  }
}

export function patientToApiPayload(patient: Patient): Record<string, unknown> {
  return {
    trialId: patient.trialId,
    externalId: patient.id,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    condition: patient.condition,
    diagnosis: patient.diagnosis,
    stage: patient.stage,
    eligibilityScore: patient.eligibilityScore,
    aiConfidence: patient.aiConfidence,
    riskLevel: patient.riskLevel,
    reasons: patient.reasons,
    riskFlags: patient.riskFlags,
    history: patient.history,
    medications: patient.medications,
    labResults: patient.labResults,
    outreach: patient.outreach,
    notes: patient.notes,
    activityLog: patient.activityLog,
    flagged: patient.flagged,
    lastContact: patient.lastContact,
    tags: patient.tags,
    uploadedAt: patient.uploadedAt,
  }
}
