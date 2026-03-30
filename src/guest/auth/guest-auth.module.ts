import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { GuestAuthService } from './guest-auth.service';
import { GuestAuthController } from './guest-auth.controller';
import { GuestJwtStrategy } from '../../common/guards/guest-jwt.strategy';
import { GoogleStrategy } from './google.strategy';

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
  providers: [GuestAuthService, GuestJwtStrategy, GoogleStrategy],
  controllers: [GuestAuthController],
  exports: [GuestAuthService],
})
export class GuestAuthModule {}
