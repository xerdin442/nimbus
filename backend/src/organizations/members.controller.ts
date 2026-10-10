import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentUser,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext } from '@src/common/types';
import { MembersService } from './members.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/member.dto';

@Dashboard('owner', 'manager')
@Controller('dashboard/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentMembership() membership: MembershipContext) {
    return this.members.list(membership);
  }

  @Post('invitations')
  invite(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: { id: string },
    @Body() dto: InviteMemberDto,
  ) {
    return this.members.invite(membership, user.id, dto);
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  resend(
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.members.resendInvitation(membership, user.id, id);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.members.revokeInvitation(membership, id);
  }

  @Patch(':userId')
  update(
    @CurrentMembership() membership: MembershipContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.updateMember(membership, userId, dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.members.removeMember(membership, userId);
  }
}
