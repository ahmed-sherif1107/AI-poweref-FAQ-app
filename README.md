# AI-Powered FAQ App

A **Retrieval-Augmented Generation (RAG)** backend that lets you upload documents (PDF and TXT), index them in a vector store, and get AI-generated answers to questions based on your content. Built with **NestJS**, **LangChain**, **ChromaDB**, and **Groq** (LLM).

---

## What This Project Does

- **Document ingestion**: Upload PDF or plain-text files. Documents are split into chunks, embedded with [Hugging Face](https://huggingface.co/) embeddings, and stored in [ChromaDB](https://www.trychroma.com/) for semantic search.
- **RAG-based Q&A**: When you ask a question, the app finds the most relevant chunks, passes them as context to an LLM (Groq / Llama 3.1), and returns an answer grounded in your documents, with optional source filenames and relevance scores.
- **Document management**: List indexed documents, delete by filename, and avoid re-indexing duplicates (via file hash).
- **Flexible ChromaDB setup**: Use a local ChromaDB server, in-memory storage, or Chroma Cloud, configured via environment variables.

---

## Tech Stack

| Layer        | Technology |
|-------------|------------|
| Backend     | NestJS (Node.js / TypeScript) |
| RAG / LLM   | LangChain, LangGraph |
| Embeddings  | Hugging Face Inference API (e.g. `sentence-transformers/all-MiniLM-L6-v2`) |
| Vector DB   | ChromaDB (local, in-memory, or Chroma Cloud) |
| LLM         | Groq (`llama-3.1-8b-instant`) |

---

## Prerequisites

- **Node.js** (v18+)
- **Yarn**
- **ChromaDB** (unless using in-memory mode):  
  e.g. `docker run -p 8000:8000 chromadb/chroma`
- **API keys** (see [Environment variables](#environment-variables))

---

## Project Setup

```bash
yarn install
```

---

## Environment Variables

Create a `.env` in the project root. Example:

```env
# Required for embeddings
HUGGINGFACE_API_KEY=your_huggingface_api_key

# Required for LLM answers (Groq)
GROQ_API_KEY=your_groq_api_key

# Optional: ChromaDB
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=rag_documents

# Optional: use Chroma Cloud instead of local
# CHROMA_USE_CLOUD=true
# CHROMA_API_KEY=...
# CHROMA_TENANT=...
# CHROMA_DATABASE=...

# Optional: in-memory ChromaDB (no server; data lost on restart)
# CHROMA_IN_MEMORY=true

# Optional: chunking
# CHUNK_SIZE=1000
# CHUNK_OVERLAP=200
# EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

PORT=3000
```

---

## Run the Project

```bash
# Development (watch mode)
yarn run start:dev

# Production
yarn run start:prod
```

API base: `http://localhost:3000` (or your `PORT`).

---

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/rag/upload` | Upload a PDF or TXT file (form field `file`) to index it. |
| `POST` | `/rag/query` | Send a question; returns an answer using RAG + LLM. Body: `{ "question": "...", "topK?: number", "minScore?: number" }`. |
| `GET`  | `/rag/documents` | List indexed documents (filename, upload date, chunk count). |
| `DELETE` | `/rag/documents` | Delete all chunks for a document. Body: `{ "filename": "..." }`. |
| `GET`  | `/rag/health` | RAG/ChromaDB health check. |
| `POST` | `/ask` | Direct LLM call (no RAG). Body: `{ "question": "..." }`. |

---

## Run Tests

```bash
yarn run test           # unit tests
yarn run test:e2e       # e2e tests
yarn run test:cov       # coverage
```

---

## For Your CV

You can use these bullets to describe this project on your CV or portfolio:

- **Built an AI-powered FAQ/Q&A backend** using Retrieval-Augmented Generation (RAG) with NestJS, LangChain, ChromaDB, and Groq, enabling semantic search over custom documents and LLM-generated answers with source attribution.
- **Implemented end-to-end document ingestion**: PDF and text uploads, configurable chunking (RecursiveCharacterTextSplitter), Hugging Face embeddings, vector storage in ChromaDB, and duplicate detection via file hashing.
- **Designed a REST API** for document upload, RAG-based querying with configurable `topK` and optional score filtering, document listing and deletion, and a health check endpoint; integrated a separate direct-LLM endpoint for non-RAG use cases.
- **Supported multiple deployment options** for the vector store (local ChromaDB server, in-memory mode, or Chroma Cloud) via environment configuration, with structured logging and error handling across the RAG pipeline.

---

## License

MIT (or as specified in the repository).
