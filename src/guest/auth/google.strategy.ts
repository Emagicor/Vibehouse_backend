import { Injectable } from '@nestjs/common';
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
  constructor() {
    super({
      clientID: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_OAUTH_CALLBACK_URL ?? 'http://localhost:8080/guest/auth/google/callback',
      scope: ['openid', 'email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
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
