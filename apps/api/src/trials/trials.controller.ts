import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common'
import { Role } from '@prisma/client'
import { TrialsService } from './trials.service'
import { CreateTrialDto, UpdateTrialDto } from './dto/trial.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'

@Controller('trials')
@UseGuards(JwtAuthGuard)
export class TrialsController {
  constructor(private readonly trials: TrialsService) {}

  @Get()
  findAll(@Query('includeArchived') includeArchived?: string) {
    return this.trials.findAll(includeArchived === 'true')
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trials.findOne(id)
  }

  @Post()
  @Roles(Role.admin)
  create(@Body() dto: CreateTrialDto, @Request() req: { user: { id: string } }) {
    return this.trials.create(dto, req.user.id)
  }

  @Patch(':id')
  @Roles(Role.admin)
  update(@Param('id') id: string, @Body() dto: UpdateTrialDto) {
    return this.trials.update(id, dto)
  }
}
