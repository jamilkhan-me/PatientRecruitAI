import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { RecruitStage, RiskLevel } from '@prisma/client'

export class CreatePatientDto {
  @IsString() trialId!: string
  @IsOptional() @IsString() externalId?: string
  @IsString() name!: string
  @IsInt() @Min(18) age!: number
  @IsString() gender!: string
  @IsString() condition!: string
  @IsOptional() @IsString() diagnosis?: string
  @IsOptional() @IsEnum(RecruitStage) stage?: RecruitStage
  @IsOptional() @IsInt() eligibilityScore?: number
  @IsOptional() @IsInt() aiConfidence?: number
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel
  @IsOptional() @IsArray() reasons?: unknown[]
  @IsOptional() @IsArray() riskFlags?: unknown[]
  @IsOptional() @IsArray() history?: unknown[]
  @IsOptional() @IsArray() medications?: unknown[]
  @IsOptional() @IsArray() labResults?: unknown[]
  @IsOptional() @IsArray() outreach?: unknown[]
  @IsOptional() @IsArray() @IsString({ each: true }) notes?: string[]
  @IsOptional() @IsArray() activityLog?: unknown[]
  @IsOptional() @IsBoolean() flagged?: boolean
  @IsOptional() @IsString() lastContact?: string
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[]
  @IsOptional() @IsString() uploadedAt?: string
}

export class UpdatePatientDto {
  @IsOptional() @IsString() externalId?: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsInt() age?: number
  @IsOptional() @IsString() gender?: string
  @IsOptional() @IsString() condition?: string
  @IsOptional() @IsString() diagnosis?: string
  @IsOptional() @IsEnum(RecruitStage) stage?: RecruitStage
  @IsOptional() @IsInt() eligibilityScore?: number
  @IsOptional() @IsInt() aiConfidence?: number
  @IsOptional() @IsEnum(RiskLevel) riskLevel?: RiskLevel
  @IsOptional() @IsArray() reasons?: unknown[]
  @IsOptional() @IsArray() riskFlags?: unknown[]
  @IsOptional() @IsArray() history?: unknown[]
  @IsOptional() @IsArray() medications?: unknown[]
  @IsOptional() @IsArray() labResults?: unknown[]
  @IsOptional() @IsArray() outreach?: unknown[]
  @IsOptional() @IsArray() @IsString({ each: true }) notes?: string[]
  @IsOptional() @IsArray() activityLog?: unknown[]
  @IsOptional() @IsBoolean() flagged?: boolean
  @IsOptional() @IsString() lastContact?: string
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[]
  @IsOptional() @IsString() uploadedAt?: string
}

export class BulkCreatePatientsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePatientDto)
  patients!: CreatePatientDto[]
}
