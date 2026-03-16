import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtStrategy } from '../../common/guards/admin-jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'fallback-secret',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [AdminAuthService, AdminJwtStrategy],
  controllers: [AdminAuthController],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
