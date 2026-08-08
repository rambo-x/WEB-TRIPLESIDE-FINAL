"""TripleSide Studio API — entrypoint. Thin wiring of routers + middleware + seed."""
import logging
import os
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

from core import mongo_client, db, CORS_ORIGINS  # noqa: E402
from core.seed import seed_all  # noqa: E402
from routers import public, admin_auth, customer, admin, checkout, blog, license as license_router  # noqa: E402

app = FastAPI(
    title="TripleSide Studio API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["triplesidestudio.com", "www.triplesidestudio.com", "127.0.0.1", "localhost", "testserver"],
)

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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
async def on_startup():
    await seed_all()
    await db.customers.create_index(
        "email",
        unique=True,
        name="uq_customers_email_nonempty",
        partialFilterExpression={"email": {"$gt": ""}},
    )
    await db.customers.create_index(
        "phone",
        unique=True,
        name="uq_customers_phone_nonempty",
        partialFilterExpression={"phone": {"$gt": ""}},
    )
    await db.registration_otps.create_index("expires_at", expireAfterSeconds=0)
    await db.registration_otps.create_index([("email", 1), ("created_at", -1)])


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
