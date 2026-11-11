import os
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.database import initialize_database
from src.database.deps import SessionDep
from src.models import AuthSession, Request, User
from src.security import hash_password, token_digest, verify_password

router = APIRouter()
bearer = HTTPBearer(auto_error=False)
UPLOAD_DIRECTORY = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_LIMIT = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
Role = Literal["manager", "operator", "admin"]


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class CompletionInput(BaseModel):
    creation_date: date
    nomenclature: str = Field(min_length=1, max_length=200)


class UserInput(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    role: Role
    password: str | None = Field(default=None, max_length=256)


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: SessionDep,
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    auth_session = await session.get(AuthSession, token_digest(credentials.credentials))
    if auth_session is None or auth_session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия истекла")
    user = await session.get(User, auth_session.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_role(user: CurrentUser, *roles: str) -> User:
    if user.role not in roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
    return user


def user_payload(user: User) -> dict[str, object]:
    return {"id": user.id, "username": user.username, "role": user.role}


def request_payload(request: Request) -> dict[str, object]:
    return {
        "id": request.id,
        "timestamp": request.created_at,
        "requester": request.requester,
        "item_type": request.item_type,
        "model": request.model,
        "is_custom": request.is_custom,
        "size": request.size,
        "base_material": request.base_material,
        "body_material": request.body_material,
        "additional_material": request.additional_material,
        "coating": request.coating,
        "other_materials": request.other_materials,
        "order_number": request.order_number,
        "note": request.note,
        "image_url": f"/uploads/{request.image_path}" if request.image_path else None,
        "creation_date": request.creation_date,
        "nomenclature": request.nomenclature,
        "is_completed": request.creation_date is not None and bool(request.nomenclature),
    }


async def save_image(image: UploadFile | None) -> str | None:
    if image is None or not image.filename:
        return None
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Допустимы изображения JPG, PNG или WebP")
    contents = await image.read(UPLOAD_LIMIT + 1)
    if len(contents) > UPLOAD_LIMIT:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Размер изображения — не более 10 МБ")
    suffix = Path(image.filename).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимый формат изображения")
    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    filename = f"{secrets.token_hex(16)}{suffix}"
    (UPLOAD_DIRECTORY / filename).write_bytes(contents)
    return filename


async def find_request_or_404(session: AsyncSession, request_id: int) -> Request:
    request = await session.get(Request, request_id)
    if request is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Заявка не найдена")
    return request


@router.post("/init", status_code=status.HTTP_201_CREATED)
async def initialize(session: SessionDep) -> dict[str, str]:
    await initialize_database()
    username = os.getenv("ADMIN_LOGIN")
    password = os.getenv("ADMIN_PASSWORD")
    if not username or not password:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Задайте ADMIN_LOGIN и ADMIN_PASSWORD перед инициализацией",
        )
    existing_user = await session.scalar(select(User.id).limit(1))
    if existing_user is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Система уже инициализирована")
    session.add(User(username=username, password_hash=hash_password(password), role="admin"))
    await session.commit()
    return {"message": "Система и учётная запись администратора созданы"}


@router.post("/auth/login")
async def login(data: LoginInput, session: SessionDep) -> dict[str, object]:
    user = await session.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    token = secrets.token_urlsafe(32)
    session.add(
        AuthSession(
            token_hash=token_digest(token),
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=12),
        )
    )
    await session.commit()
    return {"token": token, "user": user_payload(user)}


@router.get("/auth/me")
async def get_me(user: CurrentUser) -> dict[str, object]:
    return user_payload(user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: SessionDep,
) -> None:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    await current_user(credentials, session)
    auth_session = await session.get(AuthSession, token_digest(credentials.credentials))
    if auth_session is not None:
        await session.delete(auth_session)
        await session.commit()


@router.get("/requests")
async def list_requests(session: SessionDep, user: CurrentUser) -> list[dict[str, object]]:
    statement = select(Request).order_by(Request.created_at.desc(), Request.id.desc())
    if user.role == "manager":
        statement = statement.where(Request.created_by_id == user.id)
    requests = (await session.scalars(statement)).all()
    return [request_payload(item) for item in requests]


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(
    session: SessionDep,
    user: CurrentUser,
    item_type: Annotated[str, Form(min_length=1, max_length=80)],
    model: Annotated[str, Form(min_length=1, max_length=200)],
    is_custom: Annotated[bool, Form()],
    size: Annotated[str, Form(max_length=120)] = "",
    base_material: Annotated[str, Form(max_length=200)] = "",
    body_material: Annotated[str, Form(max_length=200)] = "",
    additional_material: Annotated[str, Form(max_length=200)] = "",
    coating: Annotated[str, Form(max_length=120)] = "",
    other_materials: Annotated[str, Form(max_length=5000)] = "",
    order_number: Annotated[str, Form(max_length=120)] = "",
    note: Annotated[str, Form(max_length=5000)] = "",
    requester: Annotated[str | None, Form(max_length=120)] = None,
    image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    await require_role(user, "manager", "admin")
    if is_custom and (image is None or not image.filename):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Для кастомного изделия необходимо изображение")
    requester_name = (requester or user.username) if user.role == "admin" else user.username
    if user.role == "manager":
        duplicate = await session.scalar(
            select(Request)
            .where(
                Request.is_custom == is_custom,
                func.lower(func.trim(Request.requester)) == requester_name.strip().lower(),
                func.lower(func.trim(Request.item_type)) == item_type.strip().lower(),
                func.lower(func.trim(Request.model)) == model.strip().lower(),
                func.lower(func.trim(Request.size)) == size.strip().lower(),
                func.lower(func.trim(Request.base_material)) == base_material.strip().lower(),
                func.lower(func.trim(Request.body_material)) == body_material.strip().lower(),
                func.lower(func.trim(Request.additional_material)) == additional_material.strip().lower(),
                func.lower(func.trim(Request.coating)) == coating.strip().lower(),
                func.lower(func.trim(Request.other_materials)) == other_materials.strip().lower(),
                func.lower(func.trim(Request.order_number)) == order_number.strip().lower(),
                func.lower(func.trim(Request.note)) == note.strip().lower(),
            )
            .order_by(Request.created_at, Request.id)
            .limit(1)
        )
        if duplicate is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "message": (
                        f"Такая заявка уже существует: №{duplicate.id}, "
                        f"модель «{duplicate.model}». Новая заявка не создана."
                    ),
                    "request_id": duplicate.id,
                    "request_timestamp": duplicate.created_at.isoformat(),
                },
            )
    image_path = await save_image(image)
    request = Request(
        created_by_id=user.id,
        requester=requester_name,
        item_type=item_type,
        model=model,
        is_custom=is_custom,
        size=size,
        base_material=base_material,
        body_material=body_material,
        additional_material=additional_material,
        coating=coating,
        other_materials=other_materials,
        order_number=order_number,
        note=note,
        image_path=image_path,
    )
    session.add(request)
    await session.commit()
    await session.refresh(request)
    return request_payload(request)


@router.post("/requests/{request_id}/complete")
async def complete_request(
    request_id: int,
    data: CompletionInput,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, object]:
    await require_role(user, "operator", "admin")
    request = await find_request_or_404(session, request_id)
    request.creation_date = data.creation_date
    request.nomenclature = data.nomenclature.strip()
    await session.commit()
    await session.refresh(request)
    return request_payload(request)


@router.put("/requests/{request_id}")
async def update_request(
    request_id: int,
    session: SessionDep,
    user: CurrentUser,
    item_type: Annotated[str, Form(min_length=1, max_length=80)],
    model: Annotated[str, Form(min_length=1, max_length=200)],
    is_custom: Annotated[bool, Form()],
    size: Annotated[str, Form(max_length=120)] = "",
    base_material: Annotated[str, Form(max_length=200)] = "",
    body_material: Annotated[str, Form(max_length=200)] = "",
    additional_material: Annotated[str, Form(max_length=200)] = "",
    coating: Annotated[str, Form(max_length=120)] = "",
    other_materials: Annotated[str, Form(max_length=5000)] = "",
    order_number: Annotated[str, Form(max_length=120)] = "",
    note: Annotated[str, Form(max_length=5000)] = "",
    requester: Annotated[str, Form(min_length=1, max_length=120)] = "",
    creation_date: Annotated[date | None, Form()] = None,
    nomenclature: Annotated[str, Form(max_length=200)] = "",
    remove_image: Annotated[bool, Form()] = False,
    image: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    await require_role(user, "admin")
    request = await find_request_or_404(session, request_id)
    if is_custom and (remove_image or (image is None and not request.image_path)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Для кастомного изделия необходимо изображение")
    image_path = await save_image(image)
    if image_path is not None:
        request.image_path = image_path
    elif remove_image:
        request.image_path = None
    request.requester = requester
    request.item_type = item_type
    request.model = model
    request.is_custom = is_custom
    request.size = size
    request.base_material = base_material
    request.body_material = body_material
    request.additional_material = additional_material
    request.coating = coating
    request.other_materials = other_materials
    request.order_number = order_number
    request.note = note
    request.creation_date = creation_date
    request.nomenclature = nomenclature.strip() or None
    await session.commit()
    await session.refresh(request)
    return request_payload(request)


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_request(request_id: int, session: SessionDep, user: CurrentUser) -> None:
    await require_role(user, "admin")
    request = await find_request_or_404(session, request_id)
    await session.delete(request)
    await session.commit()


@router.get("/users")
async def list_users(session: SessionDep, user: CurrentUser) -> list[dict[str, object]]:
    await require_role(user, "admin")
    users = (await session.scalars(select(User).order_by(User.username))).all()
    return [user_payload(item) for item in users]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(data: UserInput, session: SessionDep, user: CurrentUser) -> dict[str, object]:
    await require_role(user, "admin")
    if not data.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Для нового пользователя нужен пароль")
    if len(data.password) < 8:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Пароль должен содержать не менее 8 символов",
        )
    if await session.scalar(select(User.id).where(User.username == data.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Логин уже занят")
    new_user = User(username=data.username, password_hash=hash_password(data.password), role=data.role)
    session.add(new_user)
    await session.commit()
    await session.refresh(new_user)
    return user_payload(new_user)


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    data: UserInput,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, object]:
    await require_role(user, "admin")
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    existing = await session.scalar(select(User.id).where(User.username == data.username, User.id != user_id))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Логин уже занят")
    if target.id == user.id and data.role != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя изменить собственную роль администратора")
    target.username = data.username
    target.role = data.role
    if data.password:
        target.password_hash = hash_password(data.password)
        for auth_session in list(target.sessions):
            await session.delete(auth_session)
    await session.commit()
    await session.refresh(target)
    return user_payload(target)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, session: SessionDep, user: CurrentUser) -> None:
    await require_role(user, "admin")
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if target.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить собственную учётную запись")
    if target.role == "admin":
        admin_ids = (await session.scalars(select(User.id).where(User.role == "admin"))).all()
        if len(admin_ids) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить последнего администратора")
    await session.delete(target)
    await session.commit()
