import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@src/common/guards/jwt-auth.guard';
import { CurrentUser } from '@src/common/decorators/request.decorators';
import {
  AUTH_RATE_LIMITS,
  AuthThrottle,
} from '@src/common/decorators/auth-throttle.decorator';
import type { AuthenticatedUser, ClientInfo } from '@src/common/types';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { PasswordResetService } from './password-reset.service';
import {
  AcceptInvitationDto,
  LoginDto,
  ForgotPasswordDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';

const clientInfo = (req: Request): ClientInfo => ({
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('signup')
  @AuthThrottle(AUTH_RATE_LIMITS.signup)
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, clientInfo(req));
  }

  @Post('login')
  @AuthThrottle(AUTH_RATE_LIMITS.login)
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, clientInfo(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.sessions.refresh(dto.refreshToken, clientInfo(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto) {
    return this.sessions.logout(dto.refreshToken);
  }

  @Post('invitations/accept')
  @AuthThrottle(AUTH_RATE_LIMITS.acceptInvitation)
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    return this.auth.acceptInvitation(dto, clientInfo(req));
  }

  /** Always 202, whether or not the email has an account (no email enumeration). */
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthThrottle(AUTH_RATE_LIMITS.forgotPassword)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordReset.requestReset(dto.email);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthThrottle(AUTH_RATE_LIMITS.resetPassword)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordReset.reset(dto.token, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  /** Active sessions (devices) for the logged-in user; `current` marks this one. */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.list(user.id, user.sessionId);
  }

  /** Remote sign-out of one of the user's own sessions (including this one). */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sessions.revokeForUser(user.id, id);
  }
}
