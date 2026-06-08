import { Module } from '@nestjs/common'
import { TrialsService } from './trials.service'
import { TrialsController } from './trials.controller'

@Module({
  controllers: [TrialsController],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
