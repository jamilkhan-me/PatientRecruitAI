import { PrismaClient, Role, RecruitStage, RiskLevel, TrialRecruitmentStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12)

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'sarah@clinic.org' },
      update: {},
      create: { email: 'sarah@clinic.org', passwordHash, name: 'Dr. Sarah Chen', role: Role.admin },
    }),
    prisma.user.upsert({
      where: { email: 'james@clinic.org' },
      update: {},
      create: { email: 'james@clinic.org', passwordHash, name: 'Dr. James Okafor', role: Role.researcher },
    }),
    prisma.user.upsert({
      where: { email: 'lisa@clinic.org' },
      update: {},
      create: { email: 'lisa@clinic.org', passwordHash, name: 'Lisa Park', role: Role.recruiter },
    }),
  ])

  const [admin, researcher, recruiter] = users

  const trial1 = await prisma.trial.upsert({
    where: { id: 'seed-t1' },
    update: {},
    create: {
      id: 'seed-t1',
      title: 'GLYCOCONTROL-301',
      protocolId: 'GLYCO-301',
      sponsor: 'BioPharma Research Inc.',
      phase: 'Phase III',
      therapeuticArea: 'Endocrinology',
      condition: 'Type 2 Diabetes',
      description: 'A randomized study evaluating glycemic control in adults with Type 2 Diabetes inadequately controlled on metformin.',
      recruitmentTarget: 120,
      enrollmentGoal: 60,
      enrollmentTarget: 2,
      recruitmentStatus: TrialRecruitmentStatus.Enrolling,
      ageMin: 50,
      ageMax: 75,
      targetConditions: ['Type 2 Diabetes', 'T2DM'],
      sites: [
        { id: 's1', name: 'Metro Diabetes Center', city: 'Boston', country: 'USA' },
        { id: 's2', name: 'University Hospital East', city: 'Chicago', country: 'USA' },
      ],
      startDate: new Date(daysAgo(90)),
      endDate: new Date(daysAgo(-365)),
      ownerId: admin.id,
      recruiterIds: [recruiter.id, admin.id],
      archived: false,
      protocolCriteria: {
        ageMin: 50,
        ageMax: 75,
        inclusion: ['Adults 50–75 on metformin', 'HbA1c ≥ 7.5%', 'BMI 25–40'],
        exclusion: ['Prior GLP-1 therapy', 'eGFR < 30', 'Stroke within 6 months'],
        biomarkers: ['HbA1c', 'eGFR'],
        sourceDocTitle: 'GLYCOCONTROL-301 Master Protocol v3.2',
      },
      protocolCriteriaUpdatedAt: new Date(),
    },
  })

  const trial2 = await prisma.trial.upsert({
    where: { id: 'seed-t2' },
    update: {},
    create: {
      id: 'seed-t2',
      title: 'RESPIRA-204',
      protocolId: 'RESP-204',
      sponsor: 'LungHealth Therapeutics',
      phase: 'Phase II',
      therapeuticArea: 'Pulmonology',
      condition: 'COPD',
      description: 'Study of inhaled therapy in moderate-to-severe COPD patients.',
      recruitmentTarget: 80,
      enrollmentGoal: 45,
      enrollmentTarget: 0,
      recruitmentStatus: TrialRecruitmentStatus.Recruiting,
      ageMin: 40,
      ageMax: 75,
      targetConditions: ['COPD'],
      sites: [{ id: 's4', name: 'National Lung Institute', city: 'Denver', country: 'USA' }],
      startDate: new Date(daysAgo(45)),
      endDate: new Date(daysAgo(-180)),
      ownerId: researcher.id,
      recruiterIds: [recruiter.id],
      archived: false,
    },
  })

  await prisma.trial.upsert({
    where: { id: 'seed-t3' },
    update: {},
    create: {
      id: 'seed-t3',
      title: 'NEUROGUARD-101',
      protocolId: 'NEURO-101',
      sponsor: 'NeuroAdvance Labs',
      phase: 'Phase I',
      therapeuticArea: 'Neurology',
      condition: "Parkinson's Disease",
      description: 'Early-phase safety and tolerability study.',
      recruitmentTarget: 30,
      enrollmentGoal: 24,
      enrollmentTarget: 0,
      recruitmentStatus: TrialRecruitmentStatus.Planned,
      ageMin: 45,
      ageMax: 70,
      targetConditions: ["Parkinson's Disease"],
      sites: [{ id: 's6', name: 'Institute of Movement Disorders', city: 'Philadelphia', country: 'USA' }],
      startDate: new Date(daysAgo(-30)),
      endDate: new Date(daysAgo(-400)),
      ownerId: researcher.id,
      recruiterIds: [],
      archived: false,
    },
  })

  const patientSeeds = [
    {
      externalId: 'PT-001',
      trialId: trial1.id,
      name: 'James Carter',
      age: 62,
      gender: 'M',
      condition: 'Type 2 Diabetes',
      diagnosis: 'Type 2 Diabetes',
      stage: RecruitStage.Eligible,
      eligibilityScore: 92,
      aiConfidence: 94,
      riskLevel: RiskLevel.low,
      tags: ['High priority'],
      notes: ['Patient very interested. Scheduling consent visit.'],
      reasons: [{ feature: 'Age within protocol range', passed: true, weight: 20, detail: 'Age 62 within 50–75 range' }],
      riskFlags: [{ type: 'Hypertension', level: 'low', note: 'Controlled on medication' }],
      history: [{ date: daysAgo(1460), event: 'Type 2 Diabetes diagnosis', detail: 'HbA1c 9.4%', type: 'diagnosis' }],
      medications: [{ name: 'Metformin', dose: '1000mg', frequency: 'Twice daily', since: daysAgo(1460) }],
      labResults: [{ name: 'HbA1c', value: 8.2, unit: '%', normal: '4.0–5.6', flag: 'H' }],
      outreach: [{ id: 'o1', channel: 'email', template: 'Initial Outreach', sentAt: daysAgo(1), status: 'opened' }],
      activityLog: [{ id: 'act-1', type: 'ai', message: 'Initial AI eligibility scored', timestamp: new Date().toISOString() }],
      uploadedAt: new Date(daysAgo(3)),
      lastContact: new Date(daysAgo(1)),
    },
    {
      externalId: 'PT-002',
      trialId: trial1.id,
      name: 'Maria Santos',
      age: 58,
      gender: 'F',
      condition: 'Type 2 Diabetes',
      diagnosis: 'Type 2 Diabetes',
      stage: RecruitStage.Interested,
      eligibilityScore: 78,
      aiConfidence: 81,
      riskLevel: RiskLevel.low,
      tags: ['Verified'],
      notes: [],
      reasons: [],
      riskFlags: [],
      history: [],
      medications: [],
      labResults: [],
      outreach: [],
      activityLog: [],
      uploadedAt: new Date(daysAgo(5)),
      lastContact: new Date(daysAgo(2)),
    },
    {
      externalId: 'PT-003',
      trialId: trial1.id,
      name: 'Robert Nguyen',
      age: 67,
      gender: 'M',
      condition: 'Hypertension + T2DM',
      diagnosis: 'Hypertension + T2DM',
      stage: RecruitStage.Contacted,
      eligibilityScore: 65,
      aiConfidence: 72,
      riskLevel: RiskLevel.medium,
      tags: [],
      notes: [],
      reasons: [],
      riskFlags: [{ type: 'Cardiac concern', level: 'medium', note: 'History of angina' }],
      history: [],
      medications: [],
      labResults: [],
      outreach: [],
      activityLog: [],
      uploadedAt: new Date(daysAgo(7)),
    },
    {
      externalId: 'PT-004',
      trialId: trial1.id,
      name: 'Eleanor Brooks',
      age: 71,
      gender: 'F',
      condition: 'Type 2 Diabetes',
      diagnosis: 'Type 2 Diabetes',
      stage: RecruitStage.Identified,
      eligibilityScore: 34,
      aiConfidence: 68,
      riskLevel: RiskLevel.high,
      tags: [],
      notes: [],
      reasons: [],
      riskFlags: [{ type: 'Renal exclusion', level: 'high', note: 'eGFR borderline' }],
      history: [],
      medications: [],
      labResults: [],
      outreach: [],
      activityLog: [],
      uploadedAt: new Date(daysAgo(10)),
    },
    {
      externalId: 'PT-005',
      trialId: trial2.id,
      name: 'David Park',
      age: 55,
      gender: 'M',
      condition: 'COPD',
      diagnosis: 'COPD',
      stage: RecruitStage.Consented,
      eligibilityScore: 88,
      aiConfidence: 90,
      riskLevel: RiskLevel.low,
      tags: [],
      notes: [],
      reasons: [],
      riskFlags: [],
      history: [],
      medications: [],
      labResults: [],
      outreach: [],
      activityLog: [],
      uploadedAt: new Date(daysAgo(4)),
    },
  ]

  for (const p of patientSeeds) {
    await prisma.patient.upsert({
      where: { id: `seed-${p.externalId}` },
      update: {},
      create: {
        id: `seed-${p.externalId}`,
        externalId: p.externalId,
        trialId: p.trialId,
        name: p.name,
        age: p.age,
        gender: p.gender,
        condition: p.condition,
        diagnosis: p.diagnosis,
        stage: p.stage,
        eligibilityScore: p.eligibilityScore,
        aiConfidence: p.aiConfidence,
        riskLevel: p.riskLevel,
        reasons: p.reasons,
        riskFlags: p.riskFlags,
        history: p.history,
        medications: p.medications,
        labResults: p.labResults,
        outreach: p.outreach,
        notes: p.notes,
        activityLog: p.activityLog,
        tags: p.tags,
        uploadedAt: p.uploadedAt,
        lastContact: p.lastContact,
      },
    })
  }

  console.log('Seed complete.')
  console.log('Demo logins (password: password123):')
  console.log('  sarah@clinic.org  (admin)')
  console.log('  james@clinic.org  (researcher)')
  console.log('  lisa@clinic.org   (recruiter)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
