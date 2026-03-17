import { Global, Module, Logger } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        const logger = new Logger('RedisModule');

        if (!redisUrl) {
          logger.warn(
            'REDIS_URL not set — falling back to in-memory cache. Set REDIS_URL for Redis Cloud.',
          );
          return { ttl: 300_000 }; // 5 min default, in-memory
        }

        try {
          const store = await redisStore({
            url: redisUrl,
            ttl: 300_000, // default 5 min (in ms)
          });

          // Log connection success
          store.client.on('connect', () => {
            logger.log('Redis cache connected successfully');
          });
          store.client.on('error', (err: Error) => {
            logger.error(`Redis connection error: ${err.message}`);
          });

          return { store };
        } catch (err) {
          logger.error(
            `Failed to connect to Redis — falling back to in-memory cache: ${(err as Error).message}`,
          );
          return { ttl: 300_000 };
        }
      },
    }),
  ],
  providers: [CacheService],
  exports: [CacheModule, CacheService],
})
export class RedisModule {}
