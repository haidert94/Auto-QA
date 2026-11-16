import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, type Workspace, WorkspaceGuard } from '../commerce/workspace.guard';
import { BudgetService } from './budget.service';

@Controller('ai')
@UseGuards(WorkspaceGuard)
export class AiController {
  constructor(private readonly budget: BudgetService) {}

  @Get('budget')
  async budget_(@CurrentWorkspace() workspace: Workspace) {
    if (!workspace.organizationId) {
      return { monthKey: null, aiTokensUsed: 0, aiTokensLimit: 0, aiCostCop: 0, remainingTokens: 0 };
    }
    return this.budget.getBudget(workspace.organizationId);
  }
}
