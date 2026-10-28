"""FastAPI app: CORS, startup load, routes."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import router
from .state import state


@asynccontextmanager
async def lifespan(app):
    state.load()
    yield


# Extra allowed origins (e.g. the Netlify site URL), comma-separated, from the CORS_ORIGINS env var.
ORIGINS = ["http://localhost:5173", "http://localhost:5174"] + [
    o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]

app = FastAPI(title="Consumer Behaviour Analytics API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS,
                   allow_origin_regex=r"https://([a-z0-9-]+--)?[a-z0-9-]+\.netlify\.app",
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
