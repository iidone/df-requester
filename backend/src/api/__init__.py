from fastapi import APIRouter

from src.api.routes import router as api_router

main_router = APIRouter()
main_router.include_router(api_router)