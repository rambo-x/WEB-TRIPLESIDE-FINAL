"""Server-rendered HTML shells for public blog routes.

The React app replaces the fallback markup after loading. Crawlers and visitors
still receive meaningful content, metadata, and links before JavaScript runs.
"""
from datetime import datetime
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from core import db


router = APIRouter()
SITE_URL = "https://triplesidestudio.com"
INDEX_PATH = Path(__file__).resolve().parents[2] / "frontend" / "build" / "index.html"
DEFAULT_IMAGE = (
    "https://images.pexels.com/photos/10933686/pexels-photo-10933686.jpeg"
    "?auto=compress&cs=tinysrgb&dpr=2&h=630&w=1200"
)
CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
}


def _read_index() -> str:
    try:
        return INDEX_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(503, "Frontend is temporarily unavailable") from exc


def _set_meta(document: str, attribute: str, key: str, value: str) -> str:
    pattern = (
        rf'<meta\s+{re.escape(attribute)}="{re.escape(key)}"'
        r'\s+content="[^"]*"\s*/?>'
    )
    tag = (
        f'<meta {attribute}="{escape(key, quote=True)}" '
        f'content="{escape(value, quote=True)}"/>'
    )
    if re.search(pattern, document, flags=re.IGNORECASE):
        return re.sub(pattern, tag, document, count=1, flags=re.IGNORECASE)
    return document.replace("</head>", f"{tag}</head>", 1)


def _date_text(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value or "").strip()
    return text[:10] if len(text) >= 10 else ""


def _plain_markdown(value) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_~]+", "", text)
    return text


def _content_blocks(value) -> str:
    text = _plain_markdown(value)
    if not text:
        return ""

    blocks = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue

        if all(re.match(r"^[-+]\s+", line) for line in lines):
            items = "".join(
                f"<li>{escape(re.sub(r'^[-+]\\s+', '', line))}</li>"
                for line in lines
            )
            blocks.append(f"<ul>{items}</ul>")
            continue

        heading = re.match(r"^#{1,6}\s+(.+)$", lines[0])
        if heading and len(lines) == 1:
            blocks.append(f"<h2>{escape(heading.group(1))}</h2>")
            continue

        paragraph = " ".join(re.sub(r"^#{1,6}\s+", "", line) for line in lines)
        blocks.append(f"<p>{escape(paragraph)}</p>")

    return "".join(blocks)


def _navigation() -> str:
    return """
      <nav aria-label="Primary" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:44px">
        <a href="/" style="color:#fff;font-weight:800;text-decoration:none">TripleSide Studio</a>
        <a href="/songs" style="color:#a1a1aa">Music</a>
        <a href="/gear" style="color:#a1a1aa">Gear</a>
        <a href="/shop" style="color:#a1a1aa">Shop</a>
        <a href="/blog" style="color:#fb7185">Journal</a>
      </nav>
    """


def _layout(content: str) -> str:
    return f"""
      <div style="min-height:100vh;background:#050506;color:#f4f4f5;font-family:Inter,Arial,sans-serif">
        <main style="max-width:1120px;margin:0 auto;padding:56px 24px 96px">
          {_navigation()}
          {content}
        </main>
      </div>
    """


def _inject_shell(
    document: str,
    *,
    title: str,
    description: str,
    canonical: str,
    body: str,
    structured_data: dict,
    image: str = DEFAULT_IMAGE,
    page_type: str = "website",
) -> str:
    full_title = f"{title} | TripleSide Studio"
    document = re.sub(
        r"<title>.*?</title>",
        f"<title>{escape(full_title)}</title>",
        document,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    document = _set_meta(document, "name", "description", description)
    document = _set_meta(document, "name", "robots", "index, follow, max-image-preview:large")
    document = _set_meta(document, "name", "googlebot", "index, follow, max-image-preview:large")
    document = _set_meta(document, "property", "og:type", page_type)
    document = _set_meta(document, "property", "og:title", full_title)
    document = _set_meta(document, "property", "og:description", description)
    document = _set_meta(document, "property", "og:url", canonical)
    document = _set_meta(document, "property", "og:image", image)
    document = _set_meta(document, "name", "twitter:title", full_title)
    document = _set_meta(document, "name", "twitter:description", description)
    document = _set_meta(document, "name", "twitter:image", image)

    document = re.sub(
        r'<link\s+rel="canonical"[^>]*>',
        "",
        document,
        flags=re.IGNORECASE,
    )
    schema = json.dumps(
        structured_data,
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    head = (
        f'<link rel="canonical" href="{escape(canonical, quote=True)}"/>'
        f'<script type="application/ld+json">{schema}</script>'
    )
    document = document.replace("</head>", f"{head}</head>", 1)
    document = re.sub(
        r"<noscript>.*?</noscript>",
        "",
        document,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    document = document.replace(
        '<div id="root"></div>',
        f'<div id="root">{body}</div>',
        1,
    )
    return document


def _response(document: str, canonical: str) -> HTMLResponse:
    headers = dict(CACHE_HEADERS)
    headers["Link"] = f'<{canonical}>; rel="canonical"'
    return HTMLResponse(document, headers=headers)


@router.api_route("/blog", methods=["GET", "HEAD"], include_in_schema=False)
async def blog_index():
    posts = await db.blog_posts.find(
        {"status": "published"},
        {
            "_id": 0,
            "slug": 1,
            "title": 1,
            "excerpt": 1,
            "featured_image": 1,
            "tags": 1,
            "published_at": 1,
            "created_at": 1,
        },
    ).sort("published_at", -1).to_list(200)

    cards = []
    list_items = []
    for position, post in enumerate(posts, start=1):
        slug = quote(str(post.get("slug") or ""), safe="-._~")
        if not slug:
            continue
        url = f"{SITE_URL}/blog/{slug}"
        title = str(post.get("title") or "Studio Journal")
        excerpt = str(post.get("excerpt") or "")
        published = _date_text(post.get("published_at") or post.get("created_at"))
        image = str(post.get("featured_image") or "").strip()
        image_html = ""
        if image:
            image_html = (
                f'<img src="{escape(image, quote=True)}" alt="{escape(title, quote=True)}" '
                'width="1200" height="750" loading="lazy" '
                'style="width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;border-radius:12px"/>'
            )
        tags = " ".join(str(tag) for tag in (post.get("tags") or [])[:3])
        cards.append(
            '<article style="padding:20px;border:1px solid #27272a;border-radius:16px;background:#0a0a0c">'
            f"{image_html}"
            f'<p style="color:#a1a1aa;font-size:13px">{escape(published)}</p>'
            f'<h2 style="font-size:25px"><a href="/blog/{escape(slug, quote=True)}" '
            f'style="color:#fff">{escape(title)}</a></h2>'
            f'<p style="color:#d4d4d8;line-height:1.7">{escape(excerpt)}</p>'
            f'<p style="color:#a1a1aa;font-size:13px">{escape(tags)}</p>'
            "</article>"
        )
        list_items.append(
            {
                "@type": "ListItem",
                "position": position,
                "url": url,
                "name": title,
            }
        )

    content = (
        '<header style="margin-bottom:42px">'
        '<p style="color:#fb7185;font-weight:800;letter-spacing:.2em;text-transform:uppercase">Journal</p>'
        '<h1 style="font-size:clamp(40px,7vw,72px);line-height:1.05;margin:12px 0">'
        "Music Production Tips, Gear & Studio Journal"
        "</h1>"
        '<p style="max-width:760px;color:#d4d4d8;font-size:18px;line-height:1.7">'
        "Practical mixing and production tutorials, studio gear insights, audio plugin guides, "
        "and behind-the-scenes stories from TripleSide Studio."
        "</p></header>"
        '<section aria-label="Latest studio articles" '
        'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px">'
        + "".join(cards)
        + "</section>"
    )
    canonical = f"{SITE_URL}/blog"
    description = (
        "Read practical music production tutorials, mixing tips, studio gear insights, "
        "audio plugin guides, and TripleSide Studio news."
    )
    schema = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "TripleSide Studio Journal",
        "url": canonical,
        "description": description,
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": list_items,
        },
    }
    document = _inject_shell(
        _read_index(),
        title="Music Production Tips, Gear & Studio Journal",
        description=description,
        canonical=canonical,
        body=_layout(content),
        structured_data=schema,
    )
    return _response(document, canonical)


@router.api_route("/blog/{slug}", methods=["GET", "HEAD"], include_in_schema=False)
async def blog_post(slug: str):
    post = await db.blog_posts.find_one(
        {"slug": slug, "status": "published"},
        {"_id": 0},
    )
    if not post:
        raise HTTPException(404, "Post not found")

    safe_slug = quote(str(post.get("slug") or slug), safe="-._~")
    canonical = f"{SITE_URL}/blog/{safe_slug}"
    title = str(post.get("title") or "TripleSide Studio Journal")
    excerpt = str(post.get("excerpt") or "").strip()
    content_text = _plain_markdown(post.get("content"))
    description = excerpt or content_text[:160]
    image = str(post.get("featured_image") or DEFAULT_IMAGE)
    published = _date_text(post.get("published_at") or post.get("created_at"))
    modified = _date_text(
        post.get("updated_at") or post.get("published_at") or post.get("created_at")
    )
    author = str(post.get("author") or "TripleSide Studio")

    article = (
        '<article style="max-width:780px">'
        '<p><a href="/blog" style="color:#fb7185">Back to Studio Journal</a></p>'
        f'<h1 style="font-size:clamp(38px,7vw,68px);line-height:1.08">{escape(title)}</h1>'
        f'<p style="color:#a1a1aa">{escape(published)} - {escape(author)}</p>'
        f'<p style="font-size:20px;line-height:1.7;color:#d4d4d8">{escape(excerpt)}</p>'
        '<div style="font-size:17px;line-height:1.8;color:#e4e4e7">'
        f"{_content_blocks(post.get('content'))}</div>"
        "</article>"
    )
    schema = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": title,
        "description": description,
        "image": [image],
        "datePublished": published,
        "dateModified": modified,
        "author": {"@type": "Person", "name": author},
        "publisher": {
            "@type": "Organization",
            "name": "TripleSide Studio",
            "logo": {
                "@type": "ImageObject",
                "url": f"{SITE_URL}/favicon.svg",
            },
        },
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
    }
    document = _inject_shell(
        _read_index(),
        title=title,
        description=description,
        canonical=canonical,
        body=_layout(article),
        structured_data=schema,
        image=image,
        page_type="article",
    )
    return _response(document, canonical)
