import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** ALB / Route 53 health check — must return 200 for tasks to stay in service. */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
