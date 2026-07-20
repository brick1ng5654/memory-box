from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import CoverSize, MusicKind, NodeType

DatePosition = Literal["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"]


class PlaylistItem(BaseModel):
    title: str = ""
    artist: str = ""
    cover_url: str | None = None
    is_favorite: bool = False


class TrackDataPayload(BaseModel):
    title: str = ""
    artist: str = ""
    kind: MusicKind = MusicKind.track
    cover_size: CoverSize = CoverSize.small
    playlist_items: list[PlaylistItem] = []
    collapsed_item_limit: int = Field(default=3, ge=0, le=10)
    show_timeline: bool = False
    duration_seconds: int = Field(default=0, ge=0, le=86400)
    hide_details: bool = False
    spotify_id: str | None = None
    cover_url: str | None = None
    spotify_cover_url: str | None = None


class TrackDataRead(TrackDataPayload):
    model_config = ConfigDict(from_attributes=True)


class SpotifyTrackSearchResult(BaseModel):
    id: str
    title: str
    artist: str
    cover_url: str | None = None
    duration_seconds: int = 0


class MediaAssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    original_filename: str
    storage_path: str
    mime_type: str
    size_bytes: int
    preview_path: str | None
    width: int | None
    height: int | None
    duration: float | None
    sort_order: int
    is_favorite: bool


class MediaAssetUpdate(BaseModel):
    sort_order: int | None = Field(default=None, ge=0)
    is_favorite: bool | None = None


class MediaNodeDuplicate(BaseModel):
    position_x: float
    position_y: float
    z_index: int = 0


class NodeCreate(BaseModel):
    type: NodeType
    title: str = Field(default="", max_length=200)
    text_content: str | None = None
    position_x: float = 0
    position_y: float = 0
    z_index: int = 0
    width: float | None = None
    height: float | None = None
    temporal_date: date | None = None
    show_date: bool = True
    show_type_label: bool = False
    date_position: DatePosition = "bottom-center"
    title_position: DatePosition = "bottom-center"
    object_data: dict | None = None
    track_data: TrackDataPayload | None = None


class NodeUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    text_content: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    z_index: int | None = None
    width: float | None = None
    height: float | None = None
    temporal_date: date | None = None
    show_date: bool = True
    show_type_label: bool = False
    date_position: DatePosition = "bottom-center"
    title_position: DatePosition = "bottom-center"
    object_data: dict | None = None
    track_data: TrackDataPayload | None = None


class NodeRead(NodeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    board_id: int
    created_at: datetime
    updated_at: datetime
    media_assets: list[MediaAssetRead] = []
    track_data: TrackDataRead | None = None


class BoardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    start_date: date | None = None
    end_date: date | None = None


class BoardCreate(BoardUpdate):
    title: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date


class BoardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    year: int
    month: int
    start_date: date
    end_date: date
    created_at: datetime
    updated_at: datetime


class EdgeCreate(BaseModel):
    source_node_id: int
    target_node_id: int
    source_handle: Literal["left", "right", "top", "bottom"] | None = None
    target_handle: Literal["left", "right", "top", "bottom"] | None = None
    label: str | None = Field(default=None, max_length=200)


class EdgeRead(EdgeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    board_id: int


class BoardDetail(BoardRead):
    nodes: list[NodeRead]
    edges: list[EdgeRead]
