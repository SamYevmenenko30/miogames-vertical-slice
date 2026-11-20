import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { PlayerRepository } from './adapters/out/player.repository';
import { TenantRepository } from './adapters/out/tenant.repository';
import { IdentityFacade } from './application/identity.facade';
import { PlayerTokenService } from './application/player-token.service';

/** The only file in this module allowed to see all three rings. */
@Module({
  providers: [
    {
      provide: PlayerTokenService,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) =>
        new PlayerTokenService(config.playerTokenSecret, config.playerTokenTtlSeconds, clock),
    },
    { provide: TenantRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new TenantRepository(uow) },
    { provide: PlayerRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new PlayerRepository(uow) },
    {
      provide: IdentityFacade,
      inject: [UnitOfWork, TenantRepository, PlayerRepository, PlayerTokenService],
      useFactory: (
        uow: UnitOfWork,
        tenants: TenantRepository,
        players: PlayerRepository,
        tokens: PlayerTokenService,
      ) => new IdentityFacade(uow, tenants, players, tokens),
    },
  ],
  exports: [IdentityFacade],
})
export class IdentityModule {}
