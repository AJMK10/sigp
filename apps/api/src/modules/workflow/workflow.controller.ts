import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentCtx, Ctx } from '../../common/context';
import { parse, z, zId } from '../../common/validation';
import { WorkflowService } from './workflow.service';

@Controller('validations')
export class WorkflowController {
  constructor(private readonly wf: WorkflowService) {}
  @Get() inbox(@CurrentCtx() ctx: Ctx) { return this.wf.inbox(ctx); }
  @Get('historique') history(@CurrentCtx() ctx: Ctx) { return this.wf.history(ctx); }
  @Post(':id/decision')
  decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ approve: z.boolean(), comment: z.string().max(2000).optional() }), body);
    return this.wf.decide(ctx, parse(zId, id), b.approve, b.comment);
  }
}
