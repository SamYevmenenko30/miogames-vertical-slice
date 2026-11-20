#!/usr/bin/env node
/**
 * Two tenants — the two simulated operators — with a wheel, a reward rule and a
 * store item each. Prints the credentials, because a reviewer needs them to make
 * a signed request by hand.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IdentityFacade } from '../src/modules/identity';
import { WheelConfigService } from '../src/modules/gamification';
import { RewardsFacade } from '../src/modules/rewards';
import { UnitOfWork } from '../src/platform/db/unit-of-work';
import { seedEverything, STORE_ITEM, TENANTS } from './seed-data';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    await seedEverything({
      identity: app.get(IdentityFacade),
      wheels: app.get(WheelConfigService),
      rewards: app.get(RewardsFacade),
      uow: app.get(UnitOfWork),
    });
    console.log('db:seed — two tenants ready\n');
    for (const tenant of TENANTS) {
      console.log(`  ${tenant.id}  (${tenant.operator})`);
      console.log(`    Authorization: Bearer ${tenant.keyId}.${tenant.secret}`);
      console.log(`    webhook key id: ${tenant.keyId}   signing secret: ${tenant.secret}`);
    }
    console.log(`\n  wheel "welcome" v1, rule "welcome-bronze" (>= 20.00 EUR -> 2 spins, 7-day TTL)`);
    console.log(`  store item "${STORE_ITEM.itemId}" at ${STORE_ITEM.price} coins\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(`db:seed — FAILED: ${String(error)}`);
  process.exit(1);
});
