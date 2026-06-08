import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { TrialsModule } from './trials/trials.module'
import { PatientsModule } from './patients/patients.module'
import { UsersModule } from './users/users.module'
import { HealthController } from './health.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TrialsModule,
    PatientsModule,
    UsersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
