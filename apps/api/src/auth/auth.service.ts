import {
  Injectable, UnauthorizedException, ConflictException, BadRequestException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import { randomInt } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto'
import { toApiUser } from '../common/mappers'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    if (existing) throw new ConflictException('Email already registered')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        role: dto.role ?? 'recruiter',
      },
    })
    return this.buildAuthResponse(user)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    if (!user) throw new UnauthorizedException('Invalid email or password')

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw new UnauthorizedException('Invalid email or password')

    return this.buildAuthResponse(user)
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    const generic = {
      message: 'If an account exists for that email, a reset code has been sent.',
      expiresInMinutes: 15,
    }

    if (!user) return generic

    const code = String(randomInt(100000, 999999))
    const tokenHash = await bcrypt.hash(code, 10)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    })

    const demoMode = this.config.get<string>('APP_DEMO_MODE', 'true') !== 'false'
    return {
      ...generic,
      ...(demoMode ? { resetCode: code, demoNote: 'Email is not configured in demo mode — use this code to reset your password.' } : {}),
    }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new BadRequestException('Invalid or expired reset code')

    const tokens = await this.prisma.passwordResetToken.findMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })

    let matchedId: string | null = null
    for (const t of tokens) {
      if (await bcrypt.compare(dto.code, t.tokenHash)) {
        matchedId = t.id
        break
      }
    }

    if (!matchedId) throw new BadRequestException('Invalid or expired reset code')

    const passwordHash = await bcrypt.hash(dto.newPassword, 12)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: matchedId }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ])

    return { message: 'Password updated successfully. You can sign in with your new password.' }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException()
    return toApiUser(user)
  }

  private buildAuthResponse(user: { id: string; email: string; name: string; role: string; passwordHash: string; createdAt: Date; updatedAt: Date }) {
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role })
    return { accessToken: token, user: toApiUser(user as never) }
  }
}
