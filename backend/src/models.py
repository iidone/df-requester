from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(20), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    user: Mapped[User] = relationship(back_populates="sessions")


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    requester: Mapped[str] = mapped_column(String(120))
    item_type: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(200))
    is_custom: Mapped[bool] = mapped_column(default=False)
    size: Mapped[str] = mapped_column(String(120), default="")
    base_material: Mapped[str] = mapped_column(String(200), default="")
    body_material: Mapped[str] = mapped_column(String(200), default="")
    additional_material: Mapped[str] = mapped_column(String(200), default="")
    coating: Mapped[str] = mapped_column(String(120), default="")
    other_materials: Mapped[str] = mapped_column(Text, default="")
    order_number: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    creation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    nomenclature: Mapped[str | None] = mapped_column(String(200), nullable=True)
