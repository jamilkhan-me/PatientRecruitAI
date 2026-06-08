import {
  IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { TrialRecruitmentStatus } from '@prisma/client'

class AgeRangeDto {
  @IsInt() @Min(0) min!: number
  @IsInt() @Min(0) max!: number
}

class TrialSiteDto {
  @IsString() id!: string
  @IsString() name!: string
  @IsString() city!: string
  @IsString() country!: string
}

export class CreateTrialDto {
  @IsString() title!: string
  @IsString() protocolId!: string
  @IsString() sponsor!: string
  @IsString() phase!: string
  @IsString() therapeuticArea!: string
  @IsString() condition!: string
  @IsString() description!: string
  @IsInt() @Min(1) recruitmentTarget!: number
  @IsInt() @Min(1) enrollmentGoal!: number
  @IsEnum(TrialRecruitmentStatus) recruitmentStatus!: TrialRecruitmentStatus
  @ValidateNested() @Type(() => AgeRangeDto) ageRange!: AgeRangeDto
  @IsArray() @IsString({ each: true }) targetConditions!: string[]
  @IsArray() @ValidateNested({ each: true }) @Type(() => TrialSiteDto) sites!: TrialSiteDto[]
  @IsString() startDate!: string
  @IsString() endDate!: string
  @IsOptional() @IsArray() @IsString({ each: true }) recruiterIds?: string[]
  @IsOptional() @IsBoolean() archived?: boolean
  @IsOptional() @IsObject() protocolCriteria?: Record<string, unknown>
}

export class UpdateTrialDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() protocolId?: string
  @IsOptional() @IsString() sponsor?: string
  @IsOptional() @IsString() phase?: string
  @IsOptional() @IsString() therapeuticArea?: string
  @IsOptional() @IsString() condition?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsInt() recruitmentTarget?: number
  @IsOptional() @IsInt() enrollmentGoal?: number
  @IsOptional() @IsInt() enrollmentTarget?: number
  @IsOptional() @IsEnum(TrialRecruitmentStatus) recruitmentStatus?: TrialRecruitmentStatus
  @IsOptional() @ValidateNested() @Type(() => AgeRangeDto) ageRange?: AgeRangeDto
  @IsOptional() @IsArray() @IsString({ each: true }) targetConditions?: string[]
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TrialSiteDto) sites?: TrialSiteDto[]
  @IsOptional() @IsString() startDate?: string
  @IsOptional() @IsString() endDate?: string
  @IsOptional() @IsArray() @IsString({ each: true }) recruiterIds?: string[]
  @IsOptional() @IsBoolean() archived?: boolean
  @IsOptional() @IsObject() protocolCriteria?: Record<string, unknown>
}
