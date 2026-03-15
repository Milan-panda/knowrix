from fastapi import APIRouter

from app.api.v1 import auth, workspaces, sources, ingest, chat, workspace_connectors

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(workspaces.router, prefix="/workspaces", tags=["workspaces"])
api_router.include_router(workspace_connectors.router, prefix="/workspaces", tags=["connectors"])
api_router.include_router(sources.router, prefix="/sources", tags=["sources"])
api_router.include_router(ingest.router, prefix="/ingest", tags=["ingest"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
