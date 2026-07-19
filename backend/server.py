"""TripleSide Studio API — entrypoint. Thin wiring of routers + middleware + seed."""
import logging
import os
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

from core import mongo_client, CORS_ORIGINS  # noqa: E402
from core.seed import seed_all  # noqa: E402
from routers import public, admin_auth, customer, admin, checkout, blog, license as license_router  # noqa: E402

app = FastAPI(title="TripleSide Studio API")

api = APIRouter(prefix="/api")
api.include_router(public.router)
api.include_router(blog.router)
api.include_router(admin_auth.router)
api.include_router(customer.router)
api.include_router(admin.router, prefix="/admin")
api.include_router(checkout.router)
api.include_router(license_router.router)
api.include_router(license_router.admin_router, prefix="/admin")

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await seed_all()


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
