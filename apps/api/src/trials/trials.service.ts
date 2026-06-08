import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTrialDto, UpdateTrialDto } from './dto/trial.dto'
import { toApiTrial, trialToPrismaCreate, trialToPrismaUpdate } from '../common/mappers'

@Injectable()
export class TrialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeArchived = false) {
    const trials = await this.prisma.trial.findMany({
      where: includeArchived ? undefined : { archived: false },
      orderBy: { updatedAt: 'desc' },
    })
    return trials.map(toApiTrial)
  }

  async findOne(id: string) {
    const trial = await this.prisma.trial.findUnique({ where: { id } })
    if (!trial) throw new NotFoundException('Trial not found')
    return toApiTrial(trial)
  }

  async create(dto: CreateTrialDto, ownerId: string) {
    const trial = await this.prisma.trial.create({
      data: trialToPrismaCreate(dto, ownerId),
    })
    return toApiTrial(trial)
  }

  async update(id: string, dto: UpdateTrialDto) {
    await this.findOne(id)
    const trial = await this.prisma.trial.update({
      where: { id },
      data: trialToPrismaUpdate(dto),
    })
    return toApiTrial(trial)
  }
}
