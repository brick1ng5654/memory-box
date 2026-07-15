import enum
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class NodeType(str, enum.Enum):
    note = "note"
    media = "media"
    track = "track"


class MusicKind(str, enum.Enum):
    track = "track"
    playlist = "playlist"


class CoverSize(str, enum.Enum):
    small = "small"
    large = "large"


class Board(Base):
    __tablename__ = "boards"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    nodes: Mapped[list["MemoryNode"]] = relationship(back_populates="board", cascade="all, delete-orphan")
    edges: Mapped[list["MemoryEdge"]] = relationship(back_populates="board", cascade="all, delete-orphan")


class MemoryNode(Base):
    __tablename__ = "memory_nodes"
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    type: Mapped[NodeType] = mapped_column(Enum(NodeType))
    title: Mapped[str] = mapped_column(String(200), default="")
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    position_x: Mapped[float] = mapped_column(default=0)
    position_y: Mapped[float] = mapped_column(default=0)
    z_index: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[float | None] = mapped_column(nullable=True)
    height: Mapped[float | None] = mapped_column(nullable=True)
    temporal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    board: Mapped[Board] = relationship(back_populates="nodes")
    media_assets: Mapped[list["MediaAsset"]] = relationship(back_populates="node", cascade="all, delete-orphan", order_by="MediaAsset.sort_order")
    track_data: Mapped["TrackData | None"] = relationship(back_populates="node", cascade="all, delete-orphan", uselist=False)


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("memory_nodes.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(500))
    storage_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    preview_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[float | None] = mapped_column(nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    node: Mapped[MemoryNode] = relationship(back_populates="media_assets")


class TrackData(Base):
    __tablename__ = "track_data"
    node_id: Mapped[int] = mapped_column(ForeignKey("memory_nodes.id", ondelete="CASCADE"), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    artist: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[MusicKind] = mapped_column(Enum(MusicKind), default=MusicKind.track)
    cover_size: Mapped[CoverSize] = mapped_column(Enum(CoverSize), default=CoverSize.small)
    playlist_items: Mapped[list] = mapped_column(JSON, default=list)
    collapsed_item_limit: Mapped[int] = mapped_column(Integer, default=3)
    spotify_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    spotify_cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    node: Mapped[MemoryNode] = relationship(back_populates="track_data")


class MemoryEdge(Base):
    __tablename__ = "memory_edges"
    __table_args__ = (UniqueConstraint("board_id", "source_node_id", "target_node_id", name="unique_edge"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    source_node_id: Mapped[int] = mapped_column(ForeignKey("memory_nodes.id", ondelete="CASCADE"))
    target_node_id: Mapped[int] = mapped_column(ForeignKey("memory_nodes.id", ondelete="CASCADE"))
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    board: Mapped[Board] = relationship(back_populates="edges")
