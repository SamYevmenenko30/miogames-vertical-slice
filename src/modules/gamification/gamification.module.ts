import { Module } from '@nestjs/common';
import { AuditLog } from '../../platform/audit/audit-log';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { IdentityModule } from '../identity/identity.module';
import { AdminWheelsController } from './adapters/in/admin-wheels.controller';
import { WheelRepository } from './adapters/out/wheel.repository';
import { WheelConfigService } from './application/wheel-config.service';

@Module({
  imports: [IdentityModule],
  controllers: [AdminWheelsController],
  providers: [
    { provide: WheelRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new WheelRepository(uow) },
    {
      provide: WheelConfigService,
      inject: [UnitOfWork, WheelRepository, AuditLog],
      useFactory: (uow: UnitOfWork, wheels: WheelRepository, audit: AuditLog) =>
        new WheelConfigService(uow, wheels, audit),
    },
  ],
  exports: [WheelConfigService],
})
export class GamificationModule {}
