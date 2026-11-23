"""Shared, sanitized Markdown for the public API and server-rendered pages."""
from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

import bleach
from bleach.html5lib_shim import Filter
from markdown_it import MarkdownIt

_TAGS = {
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
    'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'del',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
}
_ATTRIBUTES = {
    'a': ['href', 'title'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'code': ['class'],
    'ol': ['start'],
}


def image_url(value: str) -> str:
    value = value.strip()
    if not value or re.search(r'[\x00-\x20\x7f\\]', value):
        return ''
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        if parsed.port == 0:
            return ''
    except ValueError:
        return ''
    if parsed.scheme:
        return value if parsed.scheme.lower() in {'http', 'https'} and hostname else ''
    return value if not parsed.netloc and not value.startswith('//') else ''


class _Images(Filter):
    def __iter__(self):
        for token in super().__iter__():
            if token['type'] in {'StartTag', 'EmptyTag'} and token['name'] == 'img':
                attrs = token['data']
                src = image_url(attrs.get((None, 'src'), ''))
                if not src:
                    continue
                attrs[(None, 'src')] = src
                attrs[(None, 'loading')] = 'lazy'
                attrs[(None, 'decoding')] = 'async'
                for name in ('width', 'height'):
                    value = attrs.get((None, name))
                    if value and not re.fullmatch(r'[1-9]\d{0,4}', value):
                        del attrs[(None, name)]
            yield token


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str):
        self.parts.append(data)


def render_markdown(content: str) -> str:
    rendered = MarkdownIt('commonmark', {'html': True}).enable(['table', 'strikethrough']).render(content)
    return bleach.Cleaner(
        tags=_TAGS, attributes=_ATTRIBUTES, protocols={'http', 'https', 'mailto'},
        strip=True, filters=[_Images],
    ).clean(rendered)


def description(html: str) -> str:
    text = _Text()
    text.feed(html)
    return re.sub(r'\s+', ' ', unescape(' '.join(text.parts))).strip()[:160]
