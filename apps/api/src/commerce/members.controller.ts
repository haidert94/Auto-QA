import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsUUID, Length, Matches } from 'class-validator';
import { OrgRole } from '@prisma/client';
import { AccountService } from './account';
import { MembersService } from './members.service';
import { CurrentWorkspace, RequiresRole, type Workspace, WorkspaceGuard } from './workspace.guard';

const roleValues = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const satisfies readonly OrgRole[];

class InviteDto {
  @IsEmail() @Length(3, 254) email!: string;
  @IsIn(roleValues) role!: OrgRole;
  // Opcional: proyectos a los que el invitado tendrá acceso al aceptar.
  // Solo aplica para EDITOR y VIEWER; para ADMIN/OWNER se ignora.
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  projectIds?: string[];
}

class ChangeRoleDto {
  @IsIn(roleValues) role!: OrgRole;
}

class ProjectAssignmentDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) projectIds!: string[];
}

class AcceptDto {
  @Matches(/^[a-f0-9]{64}$/) token!: string;
}

class TokenParamDto {
  @Matches(/^[a-f0-9]{64}$/) token!: string;
}

@Controller('commerce/members')
export class MembersController {
  constructor(private readonly service: MembersService, private readonly accounts: AccountService) {}

  // Previsualización pública (sin sesión): resuelve el invite para que la
  // página /invite/[token] sepa qué mostrar antes de pedir inicio de sesión.
  @Get('invite/:token')
  describe(@Param() params: TokenParamDto) {
    return this.service.describeInvite(params.token);
  }

  @Get()
  @UseGuards(WorkspaceGuard)
  list(@CurrentWorkspace() workspace: Workspace) {
    return this.service.list(workspace);
  }

  @Post('invite')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('ADMIN')
  async invite(@CurrentWorkspace() workspace: Workspace, @Body() dto: InviteDto, @Ip() ip: string) {
    this.accounts.limit('invite', workspace.organizationId ?? 'none', 20);
    return this.service.invite(workspace, dto, ip);
  }

  @Delete('invites/:id')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('ADMIN')
  @HttpCode(200)
  revoke(@CurrentWorkspace() workspace: Workspace, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.service.revokeInvite(workspace, id, ip);
  }

  @Post('accept')
  @UseGuards(WorkspaceGuard)
  @HttpCode(200)
  async accept(
    @CurrentWorkspace() workspace: Workspace,
    @Body() dto: AcceptDto,
    @Ip() ip: string,
    @Headers('authorization') auth?: string,
  ) {
    const identity = await this.accounts.identity(auth);
    return this.service.accept(workspace, dto.token, identity.email, ip);
  }

  @Delete(':userId')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('ADMIN')
  @HttpCode(200)
  remove(@CurrentWorkspace() workspace: Workspace, @Param('userId', ParseUUIDPipe) userId: string, @Ip() ip: string) {
    return this.service.remove(workspace, userId, ip);
  }

  @Patch(':userId/role')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('OWNER')
  changeRole(
    @CurrentWorkspace() workspace: Workspace,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeRoleDto,
    @Ip() ip: string,
  ) {
    return this.service.changeRole(workspace, userId, dto.role, ip);
  }

  @Put(':userId/projects')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('ADMIN')
  @HttpCode(200)
  setProjects(
    @CurrentWorkspace() workspace: Workspace,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ProjectAssignmentDto,
    @Ip() ip: string,
  ) {
    return this.service.setProjectAssignments(workspace, userId, dto.projectIds, ip);
  }

  @Get('audit')
  @UseGuards(WorkspaceGuard)
  @RequiresRole('ADMIN')
  audit(@CurrentWorkspace() workspace: Workspace) {
    return this.service.listAudit(workspace);
  }
}
