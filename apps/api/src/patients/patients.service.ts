import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto'
import { toApiPatient, patientToPrismaCreate, patientToPrismaUpdate } from '../common/mappers'

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByTrial(trialId?: string) {
    const patients = await this.prisma.patient.findMany({
      where: trialId ? { trialId } : undefined,
      orderBy: { updatedAt: 'desc' },
    })
    return patients.map(toApiPatient)
  }

  async findOne(id: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    })
    if (!patient) throw new NotFoundException('Patient not found')
    return toApiPatient(patient)
  }

  async create(dto: CreatePatientDto) {
    const patient = await this.prisma.patient.create({ data: patientToPrismaCreate(dto) })
    return toApiPatient(patient)
  }

  async createMany(dtos: CreatePatientDto[]) {
    const created = await this.prisma.$transaction(
      dtos.map((dto) => this.prisma.patient.create({ data: patientToPrismaCreate(dto) })),
    )
    return created.map(toApiPatient)
  }

  async update(id: string, dto: UpdatePatientDto) {
    const existing = await this.prisma.patient.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    })
    if (!existing) throw new NotFoundException('Patient not found')
    const patient = await this.prisma.patient.update({
      where: { id: existing.id },
      data: patientToPrismaUpdate(dto),
    })
    return toApiPatient(patient)
  }

  async resolveDbId(id: string): Promise<string> {
    const patient = await this.prisma.patient.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    })
    if (!patient) throw new NotFoundException('Patient not found')
    return patient.id
  }
}
