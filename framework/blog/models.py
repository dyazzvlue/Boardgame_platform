"""博客管理请求校验；只规范名称字段，不改动 Markdown 原始空白。"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    Field,
    StrictBool,
    StringConstraints,
    model_validator,
)

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Slug = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, pattern=r"^[\w\-]+$")
]
PositiveId = Annotated[int, Field(strict=True, gt=0)]


class LoginRequest(BaseModel):
    username: Name
    password: Annotated[str, StringConstraints(min_length=1)]


class PostCreate(BaseModel):
    title: Name
    slug: Slug | Literal[""] = ""
    content: str = ""
    cover_image: str = ""
    category_id: PositiveId | None = None
    published: StrictBool = False
    pinned: StrictBool = False
    tag_ids: list[PositiveId] = Field(default_factory=list)


class PatchRequest(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def reject_null_fields(cls, values):
        if isinstance(values, dict):
            for name, value in values.items():
                if name in cls.model_fields and name != "category_id" and value is None:
                    raise ValueError(f"{name} 不能为 null")
        return values


class PostUpdate(PatchRequest):
    title: Name | None = None
    slug: Slug | None = None
    content: str | None = None
    cover_image: str | None = None
    category_id: PositiveId | None = None
    published: StrictBool | None = None
    pinned: StrictBool | None = None
    tag_ids: list[PositiveId] | None = None


class CategoryCreate(BaseModel):
    name: Name
    slug: Slug | Literal[""] = ""
    description: str = ""


class CategoryUpdate(PatchRequest):
    name: Name | None = None
    slug: Slug | None = None
    description: str | None = None


class TagCreate(BaseModel):
    name: Name
    slug: Slug | Literal[""] = ""
