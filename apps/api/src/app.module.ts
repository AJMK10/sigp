import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DbModule } from './common/db.module';
import { AuditService } from './common/audit.service';
import { NumberingService } from './common/numbering.service';
import { NotifyService } from './common/notify.service';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthController } from './modules/auth/auth.controller';
import { WorkflowService } from './modules/workflow/workflow.service';
import { WorkflowController } from './modules/workflow/workflow.controller';
import { ReferentialsController } from './modules/referentials/referentials.controller';
import { AssetsController, LabelsController } from './modules/assets/assets.controller';
import { JournalService } from './modules/journal/journal.service';
import { JournalController } from './modules/journal/journal.controller';
import { ReceptionsController } from './modules/receptions/receptions.controller';
import { MovementsController } from './modules/movements/movements.controller';
import { InventoryController } from './modules/inventory/inventory.controller';
import { DepreciationController } from './modules/depreciation/depreciation.controller';
import { DisposalsController } from './modules/disposals/disposals.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { PortalController } from './modules/portal/portal.controller';
import { AuditController, NotificationsController } from './modules/misc/misc.controller';
import { ReportsController } from './modules/reports/reports.controller';
import { PropertyController } from './modules/property/property.controller';
import { FleetController, MissionsController } from './modules/fleet/fleet.controller';
import { MaintenanceController, ContractsController } from './modules/maintenance/maintenance.controller';
import { RevaluationController } from './modules/revaluation/revaluation.controller';
import { ClosingController } from './modules/closing/closing.controller';
import { DocumentsController } from './modules/documents/documents.controller';
import { CmatController } from './modules/cmat/cmat.controller';
import { RenewalController } from './modules/renewal/renewal.controller';
import { HealthController } from './health.controller';

/**
 * Monolithe modulaire : un module par domaine métier (référentiels, biens, entrées, mouvements, inventaire,
 * valorisation, sorties, pilotage). Les domaines communiquent par services (workflow, journal, audit, numérotation).
 */
@Module({
  imports: [DbModule, JwtModule.register({ global: true, secret: process.env.JWT_SECRET ?? 'dev-secret-change-me', signOptions: { expiresIn: '10h' } })],
  controllers: [HealthController, AuthController, WorkflowController, ReferentialsController, AssetsController, LabelsController, JournalController, ReceptionsController,
    MovementsController, InventoryController, DepreciationController, DisposalsController, DashboardController, PortalController, NotificationsController, AuditController, ReportsController,
    PropertyController, FleetController, MissionsController, MaintenanceController, ContractsController, RevaluationController, ClosingController,
    DocumentsController, CmatController, RenewalController],
  providers: [AuditService, NumberingService, NotifyService, WorkflowService, JournalService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
