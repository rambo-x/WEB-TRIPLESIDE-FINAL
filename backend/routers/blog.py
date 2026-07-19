"""Blog public routes (list published posts, fetch by slug)."""
from fastapi import APIRouter, HTTPException
from core import db

router = APIRouter()


@router.get("/blog")
async def list_blog_posts():
    posts = await db.blog_posts.find(
        {"status": "published"}, {"_id": 0, "content": 0}
    ).sort("published_at", -1).to_list(200)
    return posts


@router.get("/blog/{slug}")
async def get_blog_post(slug: str):
    post = await db.blog_posts.find_one(
        {"slug": slug, "status": "published"}, {"_id": 0}
    )
    if not post:
        raise HTTPException(404, "Post not found")
    return post
