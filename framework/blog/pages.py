"""Request-time blog HTML; no build-time article snapshots or extra Node server."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from urllib.parse import quote, urlencode, urljoin, urlsplit
from xml.etree import ElementTree as ET

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response

from ..db import get_db
from .routes import find_published_post, list_categories, list_posts, list_tags

router = APIRouter()
_DIST = Path(__file__).resolve().parent.parent / 'static' / 'dist'
_logger = logging.getLogger(__name__)
SITE_TITLE = "Dy's Blog"
SITE_DESCRIPTION = '个人博客与多人联机桌游。'


def _iso_date(value: str) -> str:
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return date.replace(tzinfo=date.tzinfo or timezone.utc).isoformat()


def public_base_url() -> str:
    value = os.environ.get('PUBLIC_BASE_URL', '').strip().rstrip('/')
    if not value:
        return ''
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in {'http', 'https'} and parsed.hostname and parsed.port != 0
            and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment and not parsed.path
            and not re.search(r'[\x00-\x20\x7f\\]', value)
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('PUBLIC_BASE_URL must be an http(s) origin, e.g. https://blog.example.com')
    return value


def _json(value: object) -> str:
    return (json.dumps(value, ensure_ascii=False).replace('&', '\\u0026')
            .replace('<', '\\u003c').replace('>', '\\u003e')
            .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))


def metadata(*, title=SITE_TITLE, description=SITE_DESCRIPTION, path='/',
             post: dict | None = None, noindex=False) -> dict:
    base = public_base_url()
    data = {
        'title': title, 'description': description, 'canonical': base + path,
        'type': 'article' if post else 'website',
        'robots': 'noindex, nofollow' if noindex else 'index, follow',
    }
    if post:
        image = post['cover_image']
        data['image'] = urljoin(base + path, image) if image else ''
        data['published'] = _iso_date(post['created_at'])
        data['modified'] = _iso_date(post['updated_at'])
        data['structured'] = {
            '@context': 'https://schema.org', '@type': 'BlogPosting',
            'headline': post['title'], 'description': description,
            'datePublished': data['published'], 'dateModified': data['modified'],
            'mainEntityOfPage': base + path,
            **({'image': data['image']} if data['image'] else {}),
        }
    return data


def _head(meta: dict) -> str:
    attrs = [
        ('name', 'description', meta['description']),
        ('name', 'robots', meta['robots']),
        ('name', 'blog-base-url', public_base_url()),
        ('property', 'og:title', meta['title']),
        ('property', 'og:description', meta['description']),
        ('property', 'og:type', meta['type']),
        ('property', 'og:url', meta['canonical']),
        ('name', 'twitter:card', 'summary_large_image' if meta.get('image') else 'summary'),
        ('name', 'twitter:title', meta['title']),
        ('name', 'twitter:description', meta['description']),
    ]
    if meta.get('image'):
        attrs += [('property', 'og:image', meta['image']), ('name', 'twitter:image', meta['image'])]
    for key, prop in [('published', 'article:published_time'), ('modified', 'article:modified_time')]:
        if meta.get(key):
            attrs.append(('property', prop, meta[key]))
    html = f'<title>{escape(meta["title"])}</title>'
    html += f'<link rel="canonical" data-blog-meta href="{escape(meta["canonical"], quote=True)}">'
    html += ''.join(
        f'<meta data-blog-meta {kind}="{name}" content="{escape(value, quote=True)}">'
        for kind, name, value in attrs
    )
    if meta.get('structured'):
        html += f'<script type="application/ld+json" data-blog-meta>{_json(meta["structured"])}</script>'
    return html


def _styles(view: str, template: str) -> str:
    manifest_path = _DIST / '.vite' / 'manifest.json'
    if not manifest_path.is_file():
        raise HTTPException(503, 'Frontend manifest missing. Run npm run build.')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    css: set[str] = set()
    seen: set[str] = set()

    def collect(key: str):
        if key in seen:
            return
        seen.add(key)
        entry = manifest[key]
        css.update(entry.get('css', []))
        for dependency in entry.get('imports', []):
            collect(dependency)

    collect(f'src/views/{view}.vue')
    return ''.join(
        f'<link rel="stylesheet" href="/{escape(path, quote=True)}">'
        for path in sorted(css) if f'href="/{path}"' not in template
    )


def page_response(meta: dict, body='', bootstrap: dict | None = None,
                  view: str | None = None, status=200) -> HTMLResponse:
    index = _DIST / 'index.html'
    if not index.is_file():
        raise HTTPException(503, 'Frontend not built. Run npm run build.')
    template = index.read_text(encoding='utf-8')
    template = re.sub(r'<title>.*?</title>', '', template, count=1, flags=re.DOTALL)
    template = template.replace('</head>', _head(meta) + (_styles(view, template) if view else '') + '</head>')
    if body:
        shell = (
            '<div id="app-root"><header class="site-header"><nav class="nav-bar">'
            '<a href="/" class="logo">Dy&#x27;s Blog</a><div class="nav-links">'
            '<a href="/">博客</a><a href="/game">游戏大厅</a></div></nav></header>'
            f'<main class="main-content">{body}</main>'
            '<footer class="site-footer"><p>&copy; 2026 Dy&#x27;s Game Room. All rights reserved.</p></footer></div>'
        )
        template = template.replace('<div id="app"></div>', f'<div id="app">{shell}</div>')
    if bootstrap is not None:
        bootstrap['meta'] = meta
        template = template.replace(
            '</body>', f'<script id="blog-bootstrap" type="application/json">{_json(bootstrap)}</script></body>',
        )
    return HTMLResponse(template, status_code=status, headers={'Cache-Control': 'no-store'})


def _url(prefix: str, slug: str) -> str:
    return prefix + quote(slug, safe='')


def _article(post: dict) -> str:
    category = post['category']
    category_link = (
        f'<a class="cat-link" href="{_url("/category/", category["slug"])}">{escape(category["name"])}</a>'
        if category else ''
    )
    tags = ''.join(f'<span class="tag-badge">{escape(tag["name"])}</span>' for tag in post['tags'])
    date = escape(post['created_at'])
    image = (
        f'<img class="cover" src="{escape(post["cover_image"], quote=True)}"'
        f' alt="{escape(post["title"], quote=True)}" width="800" height="400"'
        ' loading="eager" decoding="async" fetchpriority="high">'
        if post['cover_image'] else ''
    )
    return (
        f'<article class="post-detail"><header class="post-header"><h1>{escape(post["title"])}</h1>'
        f'<div class="post-meta"><time datetime="{date}">{date[:10]}</time>{category_link}{tags}</div>'
        f'</header>{image}<div class="post-content">{post["content_html"]}</div></article>'
    )


@router.get('/post/{slug}', include_in_schema=False)
async def article_page(slug: str, request: Request):
    post = await find_published_post(slug)
    payload = {'kind': 'post', 'url': str(request.url), 'post': post}
    if post is None:
        payload['notFound'] = True
        return page_response(
            metadata(title=f'文章不存在 | {SITE_TITLE}', path=_url('/post/', slug), noindex=True),
            '<div class="post-error-page"><h1>文章不存在</h1><p>文章不存在或已下架</p><a href="/">返回首页</a></div>',
            payload, view='PostDetail', status=404,
        )
    return page_response(
        metadata(title=f'{post["title"]} | {SITE_TITLE}', description=post['description'],
                 path=_url('/post/', post['slug']), post=post),
        _article(post), payload, view='PostDetail',
    )


def _card(post: dict) -> str:
    cover = (
        f'<img class="cover" src="{escape(post["cover_image"], quote=True)}" alt=""'
        ' width="160" height="100" loading="lazy" decoding="async">'
        if post['cover_image'] else ''
    )
    tags = ''.join(f'<span class="tag">{escape(tag["name"])}</span>' for tag in post['tags'])
    pin = '<span class="pin-badge">📌 置顶</span> ' if post['pinned'] else ''
    return (
        f'<article class="post-card card{" pinned" if post["pinned"] else ""}"><a class="post-link" href="{_url("/post/", post["slug"])}">'
        f'{cover}<div class="post-body"><h2>{pin}{escape(post["title"])}</h2>'
        f'<div class="meta"><time datetime="{escape(post["created_at"])}">{escape(post["created_at"][:10])}</time>'
        f'<span class="category">{escape(post["category"]["name"]) if post["category"] else ""}</span></div>'
        f'<div class="tags">{tags}</div></div></a></article>'
    )


async def _listing(request: Request, category: str | None = None):
    pages = request.query_params.getlist('page')
    raw_page = pages[0] if len(pages) == 1 else '1'
    page = int(raw_page) if re.fullmatch(r'[1-9][0-9]{0,15}', raw_page) else 1
    if page > 9007199254740991:
        page = 1
    requested_tags = request.query_params.getlist('tag')
    tag = requested_tags[0] if category is None and len(requested_tags) == 1 else ''
    data = await list_posts(page=page, size=10, category=category, tag=tag or None)
    categories = await list_categories()
    tags = await list_tags() if category is None else []
    current_category = next((item for item in categories if item['slug'] == category), None)
    missing = category is not None and current_category is None
    title = f'分类: {current_category["name"] if current_category else category}' if category else (
        f'标签: {tag}' if tag else SITE_TITLE
    )
    path = _url('/category/', category) if category is not None else '/'
    query = {'tag': tag} if tag else {}
    if page > 1:
        query['page'] = str(page)
    canonical = path + ('?' + urlencode(query) if query else '')
    cards = ''.join(_card(post) for post in data['posts']) or '<p class="empty">暂无文章</p>'
    pagination = ''
    for number, label in [(page - 1, '上一页'), (page + 1, '下一页')]:
        if number >= 1 and (number < page or number <= (data['total'] + 9) // 10):
            target = {**query, 'page': str(number)}
            pagination += f'<a href="{escape(path + "?" + urlencode(target), quote=True)}">{label}</a> '
    body = f'<section class="post-list"><h1 class="page-title">{escape(title)}</h1>{cards}<nav class="pagination">{pagination}</nav></section>'
    if category is None:
        links = ''.join(
            f'<li><a href="{_url("/category/", item["slug"])}">{escape(item["name"])}</a></li>'
            for item in categories
        )
        tag_links = ''.join(
            f'<a class="tag-badge" href="/?{escape(urlencode({"tag": item["slug"]}), quote=True)}">{escape(item["name"])}</a>'
            for item in tags
        )
        body = (
            f'<div class="blog-home">{body}<aside class="sidebar"><div class="card">'
            f'<h3>分类</h3><ul class="cat-list">{links}</ul></div>'
            f'<div class="card"><h3>标签</h3><div class="tag-cloud">{tag_links}</div></div></aside></div>'
        )
    else:
        body = f'<div class="category-page">{body}</div>'
    return page_response(
        metadata(title=title + (f' | {SITE_TITLE}' if title != SITE_TITLE else ''),
                 path=canonical, noindex=missing or (page > 1 and not data['posts'])),
        body, {'kind': 'category' if category is not None else 'home', 'url': str(request.url),
               'listing': data, 'categories': categories, 'tags': tags},
        view='CategoryView' if category is not None else 'BlogHome', status=404 if missing else 200,
    )


@router.get('/', include_in_schema=False)
async def home_page(request: Request):
    return await _listing(request)


@router.get('/category/{slug}', include_in_schema=False)
async def category_page(slug: str, request: Request):
    return await _listing(request, category=slug)


@router.get('/sitemap.xml', include_in_schema=False)
async def sitemap():
    base = public_base_url()
    if not base:
        _logger.error('Sitemap requires PUBLIC_BASE_URL')
        raise HTTPException(503, 'Configure PUBLIC_BASE_URL to enable sitemap.xml')
    db = await get_db()
    posts = await db.execute_fetchall('SELECT slug, updated_at FROM posts WHERE published=1 ORDER BY id')
    categories = await db.execute_fetchall(
        'SELECT c.slug FROM categories c WHERE EXISTS '
        '(SELECT 1 FROM posts p WHERE p.category_id=c.id AND p.published=1) ORDER BY c.id',
    )
    namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
    ET.register_namespace('', namespace)
    root = ET.Element(f'{{{namespace}}}urlset')
    for path, modified in [('/', None)] + [
        (_url('/post/', row[0]), row[1]) for row in posts
    ] + [(_url('/category/', row[0]), None) for row in categories]:
        node = ET.SubElement(root, 'url')
        ET.SubElement(node, 'loc').text = base + path
        if modified:
            ET.SubElement(node, 'lastmod').text = _iso_date(modified)
    return Response(ET.tostring(root, encoding='utf-8', xml_declaration=True),
                    media_type='application/xml', headers={'Cache-Control': 'no-store'})


@router.get('/robots.txt', include_in_schema=False)
async def robots():
    base = public_base_url()
    text = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /game/\n'
    if base:
        text += f'Sitemap: {base}/sitemap.xml\n'
    return Response(text, media_type='text/plain', headers={'Cache-Control': 'no-store'})
