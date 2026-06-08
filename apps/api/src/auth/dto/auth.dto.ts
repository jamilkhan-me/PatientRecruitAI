import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { Role } from '@prisma/client'

export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string

  @IsString()
  @MinLength(2)
  name!: string

  @IsOptional()
  @IsEnum(Role)
  role?: Role
}

export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  password!: string
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(6)
  code!: string

  @IsString()
  @MinLength(8)
  newPassword!: string
}
