# Knowrix

**Developer-focused knowledge base chat** — ingest docs, repos, and web content, then chat over your data with RAG (retrieval-augmented generation) and streaming LLM responses.

---

## Features

- **Multi-source ingestion**: Upload files (PDF, DOCX, TXT, MD), add web URLs, YouTube videos (transcripts), connect GitHub repos or GitHub Discussions, and sync Notion pages. Content is chunked, embedded, and stored in a vector DB for semantic search.
- **RAG chat**: Hybrid retrieval (dense vector search → dedup → cross-encoder rerank) and streaming chat powered by OpenRouter (configurable LLM). Answers are grounded in your workspace sources.
- **Workspaces**: Create workspaces, invite members (owner/admin/viewer), and scope sources and chat to each workspace. Role-based access for ingestion and management.
- **Connectors**: OAuth-based GitHub and Notion connectors per workspace for private repos, discussions, and Notion pages. Connector tokens are encrypted at rest (Fernet).
- **Background processing**: Celery workers run ingestion jobs asynchronously so the API stays responsive; jobs and source status are tracked in the database.

---

## Tech stack


| Layer              | Technology                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Frontend**       | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Framer Motion, Recharts, react-markdown |
| **Backend**        | FastAPI, SQLAlchemy (async + asyncpg), Pydantic                                          |
| **Vector DB**      | Qdrant                                                                                   |
| **Database**       | PostgreSQL 16                                                                            |
| **Object storage** | MinIO                                                                                    |
| **Queue / cache**  | Redis, Celery                                                                            |
| **Auth**           | NextAuth (frontend), JWT (backend), optional GitHub/Notion OAuth for connectors          |
| **LLM**            | OpenRouter (configurable model, e.g. `stepfun/step-3.5-flash:free`)                      |
| **Embeddings**     | sentence-transformers (e.g. `all-MiniLM-L6-v2`), optional reranker                       |


---

## Project structure

```
knowrix/
├── frontend/                 # Next.js app
│   ├── app/
│   │   ├── (marketing)/      # Landing, pricing, etc.
│   │   ├── (auth)/           # Sign in / sign up
│   │   └── (protected)/      # Dashboard, workspace, chat
│   ├── components/
│   ├── lib/                  # API client, auth context, utils
│   └── package.json
├── backend/                  # FastAPI app
│   ├── app/
│   │   ├── api/v1/           # auth, workspaces, sources, ingest, chat, workspace_connectors
│   │   ├── core/             # config, database, auth, minio, qdrant, celery, encryption
│   │   ├── ingestion/        # PDF, file, web, GitHub, Notion, chunking, embedder
│   │   ├── models/           # SQLAlchemy models, Pydantic schemas
│   │   ├── retrieval/        # hybrid search, reranker
│   │   ├── services/         # LLM service (OpenRouter)
│   │   └── tasks/            # Celery ingestion task
│   ├── requirements.txt
│   └── Dockerfile
├── nginx/                    # Production: nginx + certbot (SSL)
├── docker-compose.yml        # Base stack
├── docker-compose.dev.yml   # Dev overrides (mounts, exposed ports)
├── docker-compose.prod.yml  # Prod overrides (restart, nginx, certbot)
├── start.sh                 # Start script (Docker Compose)
└── .env.example
```

---

## Prerequisites

- Docker and Docker Compose

---

## Quick start (Docker)

1. **Clone and set environment**
   ```bash
   git clone https://github.com/Milan-panda/knowrix
   cd knowrix
   cp .env.example .env
   ```
2. **Edit `.env`**
  At minimum, set:
  - `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`
  - `OPENROUTER_API_KEY` (from [OpenRouter](https://openrouter.ai/keys))
  - `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`)
  - For GitHub/Notion connectors: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and/or `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
  - For encrypting connector tokens: `ENCRYPTION_KEY`
3. **Start the stack**
   ```bash
   ./start.sh
   ```
   This runs:
  - **postgres** (5432)
  - **qdrant** (6333)
  - **minio** (9000 API, 9001 console)
  - **redis** (6379)
  - **backend** (8000)
  - **celery_worker**
  - **frontend** (3000)
4. **Open the app**
  - Frontend: [http://localhost:3000](http://localhost:3000)  
  - Backend API: [http://localhost:8000](http://localhost:8000)  
  - API docs: [http://localhost:8000/docs](http://localhost:8000/docs)  
  - MinIO console: [http://localhost:9001](http://localhost:9001) (only exposed for dev)
5. **Sign up** via the frontend and create a workspace, then add sources and run ingestion.

---

## Environment variables

See **`.env.example`** for the full list and comments. Summary:


| Purpose              | Variables                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Ports**            | `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_EXPOSED_PORT`, `QDRANT_EXPOSED_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` |
| **URLs / CORS**      | `FRONTEND_URL`, `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXTAUTH_URL`, `CORS_ORIGINS`                                |
| **PostgreSQL**       | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                   |
| **Qdrant**           | `QDRANT_HOST`, `QDRANT_PORT`                                                                                            |
| **MinIO**            | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ENDPOINT`, `MINIO_BUCKET`                                              |
| **OpenRouter**       | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `LLM_MODEL`                                                                |
| **Embeddings**       | `EMBEDDING_MODEL`, `EMBEDDING_DIM`                                                                                      |
| **Auth**             | `NEXTAUTH_SECRET`                                                                                                       |
| **GitHub connector** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, optional `GITHUB_TOKEN`                                                     |
| **Notion connector** | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, optional `NOTION_API_KEY`, `NOTION_REDIRECT_URI`                            |
| **Security**         | `ENCRYPTION_KEY` (connector token encryption)                                                                           |
| **Production SSL**   | `API_DOMAIN`, `CERT_EMAIL` (certbot)                                                                                    |


---

## Development

Run the stack with Docker. Everything (backend, frontend, Postgres, Qdrant, MinIO, Redis, Celery worker) is started automatically.

```bash
./start.sh
```

Or with Docker Compose directly (e.g. with dev overrides for mounted code and exposed ports):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

- **Backend** → port `BACKEND_PORT` (default 8000)
- **Frontend** → port `FRONTEND_PORT` (default 3000)
- **Postgres**, **Qdrant**, **MinIO**, **Redis** — exposed per your `.env` when using the dev override

---

## Production

- Use `docker-compose.prod.yml` for restarts, nginx, and certbot. Frontend can be run behind nginx or as a separate service; the prod override shows a profile for running the frontend elsewhere (`frontend-local`).
- Set `ENVIRONMENT=prod`, real secrets, and production URLs in `.env`. Configure `CORS_ORIGINS`, `NEXTAUTH_URL`, and `BACKEND_URL` for your domains.
- SSL: configure `API_DOMAIN` and `CERT_EMAIL` and mount nginx/certbot volumes as in the prod compose file.

---

## API overview

Base URL: `/api/v1`.


| Area           | Prefix                       | Description                                                                      |
| -------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| **Auth**       | `/auth`                      | Login, signup, session (JWT)                                                     |
| **Workspaces** | `/workspaces`                | CRUD, members, invites, stats                                                    |
| **Connectors** | `/workspaces/.../connectors` | GitHub / Notion OAuth connect and status                                         |
| **Sources**    | `/sources`                   | Create (upload, PDF, web, YouTube, GitHub, Notion, GitHub Discussions), list, get, delete |
| **Ingest**     | `/ingest`                    | Trigger ingestion for a source (async job), job status                           |
| **Chat**       | `/chat`                      | Threads, messages, streaming completion (SSE)                                    |


All relevant endpoints require authentication. Workspace-scoped endpoints require membership; ingestion and some source operations require owner/admin role.

---

## Source types


| Type                   | Description                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **File upload**        | PDF, DOCX, DOC, TXT, MD via multipart upload. Stored in MinIO, then chunked and embedded.                        |
| **Web**                | URL added as a source; content is fetched and processed (e.g. HTML).                                             |
| **YouTube**            | Video URL; transcript/captions are fetched and ingested as text.                                                 |
| **GitHub**             | Repository URL; code/docs are ingested (e.g. via tree-sitter). Use workspace GitHub connector for private repos. |
| **GitHub Discussions** | Repo URL; discussions are ingested via GraphQL. Connector required for private repos.                            |
| **Notion**             | Notion page URL. Use workspace Notion connector for private pages.                                               |


Ingestion runs in a Celery task: chunking, embedding (sentence-transformers), and upsert into Qdrant with metadata (`workspace_id`, `source_id`, etc.). Payload indexes on `workspace_id` and `source_id` support fast filtered vector search.

