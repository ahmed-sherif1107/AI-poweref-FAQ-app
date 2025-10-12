import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModelCallingService } from './model-calling/model-calling.service';
import { ModelCallingController } from './model-calling/model-calling.controller';
import { ConfigModule } from '@nestjs/config';
import { RagService } from './rag/rag.service';
import { RagController } from './rag/rag.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController, ModelCallingController, RagController],
  providers: [AppService, ModelCallingService, RagService],
})
export class AppModule {}
