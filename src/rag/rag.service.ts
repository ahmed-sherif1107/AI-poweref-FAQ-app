import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HuggingFaceInferenceEmbeddings } from '@langchain/community/embeddings/hf';
import { ChromaClient, CloudClient } from 'chromadb';
import { ConfigService } from '@nestjs/config';
import { unlink } from 'fs/promises';
import * as crypto from 'crypto';

interface DocumentMetadata {
  source: string;
  filename: string;
  uploadDate: string;
  fileHash: string;
  chunkIndex: number;
  totalChunks: number;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private embeddings: HuggingFaceInferenceEmbeddings;
  private textSplitter: RecursiveCharacterTextSplitter;
  private vectorStore: Chroma;
  private chromaClient: any; // Using any to avoid module resolution conflicts
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    try {
      await this.initialize();
      this.logger.log('RAG Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize RAG Service', error);
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize HuggingFace embeddings
    this.embeddings = new HuggingFaceInferenceEmbeddings({
      apiKey: this.configService.get<string>('HUGGINGFACE_API_KEY'),
      model: this.configService.get<string>('EMBEDDING_MODEL') || 'sentence-transformers/all-MiniLM-L6-v2',
    });

    // Initialize text splitter with configurable parameters
    const chunkSize = parseInt(this.configService.get<string>('CHUNK_SIZE') || '1000', 10);
    const chunkOverlap = parseInt(this.configService.get<string>('CHUNK_OVERLAP') || '200', 10);

    // Validate chunk configuration
    if (chunkOverlap >= chunkSize) {
      this.logger.error(`Invalid chunk configuration: chunkOverlap (${chunkOverlap}) must be less than chunkSize (${chunkSize})`);
      throw new Error(`CHUNK_OVERLAP (${chunkOverlap}) must be less than CHUNK_SIZE (${chunkSize})`);
    }

    this.logger.log(`Text splitter configured: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    // Check if using Chroma Cloud or local/in-memory
    const useChromaCloud = this.configService.get<boolean>('CHROMA_USE_CLOUD') || false;
    const useInMemory = this.configService.get<boolean>('CHROMA_IN_MEMORY') || false;

    if (useChromaCloud) {
      // Initialize Chroma Cloud Client
      const apiKey = this.configService.get<string>('CHROMA_API_KEY');
      const tenant = this.configService.get<string>('CHROMA_TENANT');
      const database = this.configService.get<string>('CHROMA_DATABASE');

      if (!apiKey || !tenant || !database) {
        throw new Error('Chroma Cloud requires CHROMA_API_KEY, CHROMA_TENANT, and CHROMA_DATABASE');
      }

      this.chromaClient = new CloudClient({
        apiKey,
        tenant,
        database,
      });

      // Test connection
      try {
        await this.chromaClient.heartbeat();
        this.logger.log(`Connected to Chroma Cloud (tenant: ${tenant}, database: ${database})`);
      } catch (error) {
        this.logger.error('Failed to connect to Chroma Cloud');
        throw error;
      }

      // Initialize Chroma vector store with Cloud client
      this.vectorStore = new Chroma(this.embeddings, {
        collectionName: this.configService.get<string>('CHROMA_COLLECTION') || 'rag_documents',
        index: this.chromaClient,
        collectionMetadata: {
          'hnsw:space': 'cosine',
        },
      });

    } else if (useInMemory) {
      // Use in-memory ChromaDB (no server needed, data lost on restart)
      this.logger.warn('Using in-memory ChromaDB - data will be lost on restart');
      
      // Initialize Chroma vector store in memory
      this.vectorStore = new Chroma(this.embeddings, {
        collectionName: this.configService.get<string>('CHROMA_COLLECTION') || 'rag_documents',
        collectionMetadata: {
          'hnsw:space': 'cosine',
        },
      });
      
      this.logger.log('ChromaDB initialized in-memory mode');
    } else {
      // Use remote ChromaDB server
      const chromaUrl = this.configService.get<string>('CHROMA_URL') || 'http://localhost:8000';
      const url = new URL(chromaUrl);
      
      const chromaHost = url.hostname;
      const chromaPort = url.port || (url.protocol === 'https:' ? '443' : '8000');
      const chromaSsl = url.protocol === 'https:';

      // Initialize Chroma client with new configuration
      this.chromaClient = new ChromaClient({
        host: chromaHost,
        port: Number(chromaPort),
        ssl: chromaSsl,
      });

      // Test connection
      try {
        await this.chromaClient.heartbeat();
        this.logger.log(`Connected to ChromaDB at ${chromaHost}:${chromaPort}`);
      } catch (error) {
        this.logger.error(`Failed to connect to ChromaDB at ${chromaHost}:${chromaPort}`);
        this.logger.error('Make sure ChromaDB is running. You can start it with: docker run -p 8000:8000 chromadb/chroma');
        throw error;
      }

      // Initialize Chroma vector store
      this.vectorStore = new Chroma(this.embeddings, {
        collectionName: this.configService.get<string>('CHROMA_COLLECTION') || 'rag_documents',
        url: chromaUrl,
        collectionMetadata: {
          'hnsw:space': 'cosine',
        },
      });
    }

    this.initialized = true;
  }

  /**
   * Calculate file hash to detect duplicates
   */
  private calculateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Check if document already exists in vector store
   */
  private async isDocumentAlreadyIndexed(fileHash: string): Promise<boolean> {
    try {
      const results = await this.vectorStore.similaritySearch('', 1, {
        fileHash,
      });
      return results.length > 0;
    } catch (error) {
      this.logger.warn('Could not check for duplicate documents', error);
      return false;
    }
  }

  /**
   * Clean up uploaded file from disk
   */
  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
      this.logger.debug(`Cleaned up file: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup file: ${filePath}`, error);
    }
  }

  /**
   * Upload and index documents
   */
  async uploadDocuments(file: Express.Multer.File): Promise<{
    message: string;
    chunksIndexed: number;
    filename: string;
    isDuplicate: boolean;
  }> {
    if (!this.initialized) {
      throw new Error('RAG Service not initialized');
    }

    try {
      // Calculate file hash for duplicate detection
      const fileBuffer = require('fs').readFileSync(file.path);
      const fileHash = this.calculateFileHash(fileBuffer);

      // Check for duplicates
      const isDuplicate = await this.isDocumentAlreadyIndexed(fileHash);
      if (isDuplicate) {
        await this.cleanupFile(file.path);
        return {
          message: `Document "${file.originalname}" already indexed`,
          chunksIndexed: 0,
          filename: file.originalname,
          isDuplicate: true,
        };
      }

      // Load the document based on file type
      let loader: PDFLoader | TextLoader;
      
      if (file.mimetype === 'application/pdf') {
        loader = new PDFLoader(file.path);
      } else if (file.mimetype === 'text/plain') {
        loader = new TextLoader(file.path);
      } else {
        await this.cleanupFile(file.path);
        throw new Error('Unsupported file type');
      }

      // Load and split documents
      const docs = await loader.load();
      const splitDocs = await this.textSplitter.splitDocuments(docs);

      // Add comprehensive metadata to documents
      const docsWithMetadata = splitDocs.map((doc, index) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          source: file.originalname,
          filename: file.originalname,
          uploadDate: new Date().toISOString(),
          fileHash,
          chunkIndex: index,
          totalChunks: splitDocs.length,
          mimeType: file.mimetype,
          fileSize: file.size,
        } as DocumentMetadata,
      }));

      // Store documents in vector store
      await this.vectorStore.addDocuments(docsWithMetadata);

      // Cleanup uploaded file
      await this.cleanupFile(file.path);

      this.logger.log(`Successfully indexed ${docsWithMetadata.length} chunks from ${file.originalname}`);

      return {
        message: `Successfully uploaded and indexed ${docsWithMetadata.length} chunks from ${file.originalname}`,
        chunksIndexed: docsWithMetadata.length,
        filename: file.originalname,
        isDuplicate: false,
      };
    } catch (error: any) {
      // Ensure file cleanup even on error
      await this.cleanupFile(file.path);
      this.logger.error(`Failed to process document: ${file.originalname}`, error);
      throw new Error(`Failed to process document: ${error.message}`);
    }
  }

  /**
   * Query documents with similarity search
   */
  async queryDocuments(
    question: string,
    topK: number = 4,
    minScore?: number,
  ): Promise<{
    context: string;
    sources: Array<{ filename: string; score?: number }>;
  }> {
    if (!this.initialized) {
      throw new Error('RAG Service not initialized');
    }

    if (!question || question.trim().length === 0) {
      throw new Error('Question cannot be empty');
    }

    if (question.length > 5000) {
      throw new Error('Question too long (max 5000 characters)');
    }

    try {
      // Perform similarity search with scores
      const relevantDocs = await this.vectorStore.similaritySearchWithScore(
        question,
        topK,
      );

      // Filter by minimum score if provided
      const filteredDocs = minScore
        ? relevantDocs.filter(([_, score]) => score >= minScore)
        : relevantDocs;

      if (filteredDocs.length === 0) {
        return {
          context: '',
          sources: [],
        };
      }

      // Combine context from retrieved documents
      const context = filteredDocs
        .map(([doc]) => doc.pageContent)
        .join('\n\n---\n\n');

      // Extract unique sources with scores
      const sourcesMap = new Map<string, number>();
      filteredDocs.forEach(([doc, score]) => {
        const filename = doc.metadata.filename || 'unknown';
        const existingScore = sourcesMap.get(filename);
        if (!existingScore || score > existingScore) {
          sourcesMap.set(filename, score);
        }
      });

      const sources = Array.from(sourcesMap.entries()).map(([filename, score]) => ({
        filename,
        score,
      }));

      this.logger.debug(`Found ${filteredDocs.length} relevant documents for query`);

      return {
        context,
        sources,
      };
    } catch (error: any) {
      this.logger.error('Failed to query documents', error);
      throw new Error(`Failed to query documents: ${error.message}`);
    }
  }

  /**
   * Delete documents by filename
   */
  async deleteDocumentsByFilename(filename: string): Promise<number> {
    if (!this.initialized) {
      throw new Error('RAG Service not initialized');
    }

    try {
      const collection = await this.vectorStore.ensureCollection();
      
      // Get all documents with the filename
      const results = await collection.get({
        where: { filename },
      });

      if (results.ids.length === 0) {
        return 0;
      }

      // Delete documents
      await collection.delete({
        ids: results.ids,
      });

      this.logger.log(`Deleted ${results.ids.length} chunks from ${filename}`);

      return results.ids.length;
    } catch (error: any) {
      this.logger.error(`Failed to delete documents: ${filename}`, error);
      throw new Error(`Failed to delete documents: ${error.message}`);
    }
  }

  /**
   * List all indexed documents
   */
  async listDocuments(): Promise<Array<{
    filename: string;
    uploadDate: string;
    chunkCount: number;
  }>> {
    if (!this.initialized) {
      throw new Error('RAG Service not initialized');
    }

    try {
      const collection = await this.vectorStore.ensureCollection();
      const results = await collection.get();

      // Group by filename
      const documentsMap = new Map<string, { uploadDate: string; count: number }>();

      results.metadatas?.forEach((metadata: any) => {
        const filename = metadata.filename || 'unknown';
        const uploadDate = metadata.uploadDate || 'unknown';
        
        if (documentsMap.has(filename)) {
          documentsMap.get(filename)!.count++;
        } else {
          documentsMap.set(filename, { uploadDate, count: 1 });
        }
      });

      return Array.from(documentsMap.entries()).map(([filename, data]) => ({
        filename,
        uploadDate: data.uploadDate,
        chunkCount: data.count,
      }));
    } catch (error: any) {
      this.logger.error('Failed to list documents', error);
      throw new Error(`Failed to list documents: ${error.message}`);
    }
  }

  /**
   * Get vector store instance (for advanced usage)
   */
  getVectorStore(): Chroma {
    if (!this.initialized) {
      throw new Error('RAG Service not initialized');
    }
    return this.vectorStore;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (this.chromaClient && typeof this.chromaClient.heartbeat === 'function') {
        await this.chromaClient.heartbeat();
        return true;
      }
      // If no client (in-memory mode), assume healthy if initialized
      return this.initialized;
    } catch (error) {
      this.logger.error('Health check failed', error);
      return false;
    }
  }
}