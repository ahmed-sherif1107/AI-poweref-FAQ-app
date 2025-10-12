import {
    Controller,
    Post,
    Get,
    Delete,
    UploadedFile,
    UseInterceptors,
    Body,
    BadRequestException,
    Query,
    HttpStatus,
    HttpCode,
    Logger,
    InternalServerErrorException,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { diskStorage } from 'multer';
  import { extname, join } from 'path';
  import { RagService } from './rag.service';
  import { ModelCallingService } from '../model-calling/model-calling.service';
  import { existsSync, mkdirSync } from 'fs';
  
  // DTOs for request validation
  class QueryDto {
    question: string;
    topK?: number;
    minScore?: number;
  }
  
  class DeleteDocumentDto {
    filename: string;
  }
  
  @Controller('rag')
  export class RagController {
    private readonly logger = new Logger(RagController.name);
    private readonly uploadPath = './uploads';
  
    constructor(
      private readonly ragService: RagService,
      private readonly modelCallingService: ModelCallingService,
    ) {
      // Ensure upload directory exists
      this.ensureUploadDirectory();
    }
  
    private ensureUploadDirectory(): void {
      if (!existsSync(this.uploadPath)) {
        mkdirSync(this.uploadPath, { recursive: true });
        this.logger.log(`Created upload directory: ${this.uploadPath}`);
      }
    }
  
    @Post('upload')
    @HttpCode(HttpStatus.CREATED)
    @UseInterceptors(
      FileInterceptor('file', {
        storage: diskStorage({
          destination: './uploads',
          filename: (req, file, callback) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const ext = extname(file.originalname);
            const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
            callback(null, `${file.fieldname}-${uniqueSuffix}-${sanitizedFilename}`);
          },
        }),
        fileFilter: (req, file, callback) => {
          const allowedMimes = ['application/pdf', 'text/plain'];
          if (allowedMimes.includes(file.mimetype)) {
            callback(null, true);
          } else {
            callback(
              new BadRequestException(
                'Only PDF and TXT files are allowed. Received: ' + file.mimetype,
              ),
              false,
            );
          }
        },
        limits: {
          fileSize: 10 * 1024 * 1024, // 10MB limit
          files: 1,
        },
      }),
    )
    async uploadDocument(@UploadedFile() file: Express.Multer.File) {
      if (!file) {
        throw new BadRequestException('No file uploaded');
      }
  
      this.logger.log(`Processing upload: ${file.originalname} (${file.size} bytes)`);
  
      try {
        const result = await this.ragService.uploadDocuments(file);
  
        return {
          success: true,
          message: result.message,
          data: {
            filename: result.filename,
            size: file.size,
            chunksIndexed: result.chunksIndexed,
            isDuplicate: result.isDuplicate,
            mimeType: file.mimetype,
          },
        };
      } catch (error: any) {
        this.logger.error(`Upload failed for ${file.originalname}`, error);
        throw new InternalServerErrorException(
          `Failed to process document: ${error.message}`,
        );
      }
    }
  
    @Post('query')
    @HttpCode(HttpStatus.OK)
    async queryDocuments(@Body() body: QueryDto) {
      if (!body.question || body.question.trim().length === 0) {
        throw new BadRequestException('Question is required and cannot be empty');
      }
  
      if (body.question.length > 5000) {
        throw new BadRequestException('Question is too long (maximum 5000 characters)');
      }
  
      const topK = body.topK && body.topK > 0 && body.topK <= 20 ? body.topK : 4;
      const minScore = body.minScore && body.minScore > 0 ? body.minScore : undefined;
  
      this.logger.log(`Query received: "${body.question.substring(0, 50)}..."`);
  
      try {
        // Get relevant context from RAG
        const { context, sources } = await this.ragService.queryDocuments(
          body.question,
          topK,
          minScore,
        );
  
        if (!context || context.trim().length === 0) {
          return {
            success: true,
            question: body.question,
            answer: "I couldn't find any relevant information in the indexed documents to answer your question. Please make sure documents are uploaded or try rephrasing your question.",
            sources: [],
            contextFound: false,
          };
        }
  
        // Create enhanced prompt with context
        const enhancedPrompt = `You are a helpful assistant that answers questions based on provided context.
  
  Context from documents:
  ${context}
  
  Question: ${body.question}
  
  Instructions:
  - Answer the question based ONLY on the provided context
  - If the context doesn't contain enough information to answer fully, clearly state what information is missing
  - Be specific and cite relevant parts of the context when possible
  - If you're unsure, say so rather than making assumptions
  - Keep your answer concise but complete
  
  Answer:`;
  
        // Generate answer using the model
        const answer = await this.modelCallingService.ask(enhancedPrompt);
  
        this.logger.log(`Query answered successfully with ${sources.length} sources`);
  
        return {
          success: true,
          question: body.question,
          answer,
          sources: sources.map((s) => ({
            filename: s.filename,
            relevanceScore: s.score ? Number(s.score.toFixed(4)) : undefined,
          })),
          contextFound: true,
          contextPreview: context.substring(0, 300) + (context.length > 300 ? '...' : ''),
        };
      } catch (error: any) {
        this.logger.error('Query failed', error);
        throw new InternalServerErrorException(`Failed to process query: ${error.message}`);
      }
    }
  
    @Get('documents')
    @HttpCode(HttpStatus.OK)
    async listDocuments() {
      try {
        const documents = await this.ragService.listDocuments();
  
        return {
          success: true,
          count: documents.length,
          documents: documents.sort((a, b) => 
            new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
          ),
        };
      } catch (error: any) {
        this.logger.error('Failed to list documents', error);
        throw new InternalServerErrorException(`Failed to list documents: ${error.message}`);
      }
    }
  
    @Delete('documents')
    @HttpCode(HttpStatus.OK)
    async deleteDocument(@Body() body: DeleteDocumentDto) {
      if (!body.filename || body.filename.trim().length === 0) {
        throw new BadRequestException('Filename is required');
      }
  
      this.logger.log(`Deleting document: ${body.filename}`);
  
      try {
        const deletedCount = await this.ragService.deleteDocumentsByFilename(body.filename);
  
        if (deletedCount === 0) {
          throw new BadRequestException(`Document not found: ${body.filename}`);
        }
  
        return {
          success: true,
          message: `Successfully deleted ${deletedCount} chunks from ${body.filename}`,
          deletedChunks: deletedCount,
          filename: body.filename,
        };
      } catch (error: any) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.error(`Failed to delete document: ${body.filename}`, error);
        throw new InternalServerErrorException(`Failed to delete document: ${error.message}`);
      }
    }
  
    @Get('health')
    @HttpCode(HttpStatus.OK)
    async healthCheck() {
      try {
        const isHealthy = await this.ragService.healthCheck();
  
        return {
          success: true,
          status: isHealthy ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'RAG',
        };
      } catch (error: any) {
        this.logger.error('Health check failed', error);
        return {
          success: false,
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'RAG',
          error: error.message,
        };
      }
    }
  
    @Post('query/stream')
    @HttpCode(HttpStatus.OK)
    async queryDocumentsStream(@Body() body: QueryDto) {
      // This endpoint could be extended to support streaming responses
      // if your ModelCallingService supports streaming
      throw new BadRequestException('Streaming not yet implemented');
    }
  }