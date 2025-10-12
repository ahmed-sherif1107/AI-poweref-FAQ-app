import { Controller, Post, Body } from '@nestjs/common';
import { ModelCallingService } from './model-calling.service';

@Controller()
export class ModelCallingController {
  constructor(private readonly modelCalling: ModelCallingService) {}

  @Post('ask')
  async postAsk(@Body('question') question: string) {
    const answer = await this.modelCalling.ask(question);
    return { answer };
  }
}