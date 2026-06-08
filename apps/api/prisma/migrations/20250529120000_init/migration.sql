-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'researcher', 'recruiter');

-- CreateEnum
CREATE TYPE "RecruitStage" AS ENUM ('Identified', 'Eligible', 'Contacted', 'Interested', 'Consented');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "TrialRecruitmentStatus" AS ENUM ('Planned', 'Enrolling', 'Recruiting', 'Paused', 'Completed', 'Archived');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'recruiter',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trial" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "therapeuticArea" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recruitmentTarget" INTEGER NOT NULL,
    "enrollmentGoal" INTEGER NOT NULL,
    "enrollmentTarget" INTEGER NOT NULL DEFAULT 0,
    "recruitmentStatus" "TrialRecruitmentStatus" NOT NULL,
    "ageMin" INTEGER NOT NULL,
    "ageMax" INTEGER NOT NULL,
    "targetConditions" TEXT[],
    "sites" JSONB NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "ownerId" TEXT NOT NULL,
    "recruiterIds" TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "protocolCriteria" JSONB,
    "protocolCriteriaUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "trialId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "stage" "RecruitStage" NOT NULL DEFAULT 'Identified',
    "eligibilityScore" INTEGER NOT NULL DEFAULT 0,
    "aiConfidence" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "riskFlags" JSONB NOT NULL DEFAULT '[]',
    "history" JSONB NOT NULL DEFAULT '[]',
    "medications" JSONB NOT NULL DEFAULT '[]',
    "labResults" JSONB NOT NULL DEFAULT '[]',
    "outreach" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activityLog" JSONB NOT NULL DEFAULT '[]',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "lastContact" DATE,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Trial_ownerId_idx" ON "Trial"("ownerId");

-- CreateIndex
CREATE INDEX "Trial_archived_idx" ON "Trial"("archived");

-- CreateIndex
CREATE INDEX "Patient_trialId_idx" ON "Patient"("trialId");

-- CreateIndex
CREATE INDEX "Patient_stage_idx" ON "Patient"("stage");

-- AddForeignKey
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
