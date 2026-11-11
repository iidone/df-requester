import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api import main_router
from src.api.routes import UPLOAD_DIRECTORY
from src.database.database import engine, initialize_database


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await initialize_database()
    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    yield
    await engine.dispose()


app = FastAPI(title="DF Requester API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(main_router, prefix="/api")
UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIRECTORY), name="uploads")
