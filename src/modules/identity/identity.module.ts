import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { deriveKey } from '../../platform/crypto/crypto';
import { UnitOfWork } from '../../platform/db/unit-of-work';
import { PlayerRepository } from './adapters/out/player.repository';
import { TenantRepository } from './adapters/out/tenant.repository';
import { IdentityFacade } from './application/identity.facade';
import { PlayerTokenService } from './application/player-token.service';

/** Injection token for the derived key that encrypts stored signing secrets. */
export const SECRET_ENCRYPTION_KEY = Symbol('SecretEncryptionKey');

/** The only file in this module allowed to see all three rings. */
@Module({
  providers: [
    {
      provide: PlayerTokenService,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) =>
        new PlayerTokenService(config.playerTokenSecret, config.playerTokenTtlSeconds, clock),
    },
    {
      provide: SECRET_ENCRYPTION_KEY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => deriveKey(config.playerTokenSecret, 'mio:webhook-secret-encryption'),
    },
    {
      provide: TenantRepository,
      inject: [UnitOfWork, SECRET_ENCRYPTION_KEY],
      useFactory: (uow: UnitOfWork, key: Buffer) => new TenantRepository(uow, key),
    },
    { provide: PlayerRepository, inject: [UnitOfWork], useFactory: (uow: UnitOfWork) => new PlayerRepository(uow) },
    {
      provide: IdentityFacade,
      inject: [UnitOfWork, TenantRepository, PlayerRepository, PlayerTokenService, SECRET_ENCRYPTION_KEY],
      useFactory: (
        uow: UnitOfWork,
        tenants: TenantRepository,
        players: PlayerRepository,
        tokens: PlayerTokenService,
        key: Buffer,
      ) => new IdentityFacade(uow, tenants, players, tokens, key),
    },
  ],
  exports: [IdentityFacade],
})
export class IdentityModule {}
