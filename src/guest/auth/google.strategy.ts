import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

export interface GoogleOAuthUser {
  google_id: string;
  email: string;
  name: string;
  profile_photo_url: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor() {
    const clientID = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const callbackURL =
      process.env.GOOGLE_OAUTH_CALLBACK_URL ??
      'http://localhost:8080/guest/auth/google/callback';

    super({
      clientID: clientID!,
      clientSecret: clientSecret!,
      callbackURL,
      scope: ['openid', 'email', 'profile'],
    });

    // Log env var status at startup (values masked for security)
    const log = new Logger(GoogleStrategy.name);
    log.log(`Google OAuth config:`);
    log.log(`  clientID:     ${clientID ? clientID.substring(0, 12) + '...' : '⚠️  MISSING'}`);
    log.log(`  clientSecret: ${clientSecret ? '***SET***' : '⚠️  MISSING'}`);
    log.log(`  callbackURL:  ${callbackURL}`);
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    this.logger.log(`Google OAuth validate() called for: ${profile.displayName ?? profile.id}`);

    const email = profile.emails?.[0]?.value ?? null;
    const photo = profile.photos?.[0]?.value ?? null;

    const user: GoogleOAuthUser = {
      google_id: profile.id,
      email: email ?? '',
      name: profile.displayName || email || 'Guest',
      profile_photo_url: photo,
    };

    done(null, user);
  }
}
