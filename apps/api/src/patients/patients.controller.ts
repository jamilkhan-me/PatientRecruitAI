import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards,
} from '@nestjs/common'
import { Role } from '@prisma/client'
import { PatientsService } from './patients.service'
import { CreatePatientDto, UpdatePatientDto, BulkCreatePatientsDto } from './dto/patient.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'

@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  findAll(@Query('trialId') trialId?: string) {
    return this.patients.findByTrial(trialId)
  }

  @Post('bulk')
  @Roles(Role.admin, Role.recruiter, Role.researcher)
  createBulk(@Body() dto: BulkCreatePatientsDto) {
    return this.patients.createMany(dto.patients)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patients.findOne(id)
  }

  @Post()
  @Roles(Role.admin, Role.recruiter, Role.researcher)
  create(@Body() dto: CreatePatientDto) {
    return this.patients.create(dto)
  }

  @Patch(':id')
  @Roles(Role.admin, Role.recruiter, Role.researcher)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(id, dto)
  }
}
