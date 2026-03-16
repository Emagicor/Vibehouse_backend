import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { GuestJwtPayload } from '../guards/guest-jwt.strategy';

export const CurrentGuest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuestJwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as GuestJwtPayload;
  },
);
