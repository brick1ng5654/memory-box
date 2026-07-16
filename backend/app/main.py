import os
import uuid
import json
import base64
import time
import calendar
from datetime import date
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session, joinedload

from .database import Base, engine, get_db
from .models import Board, MediaAsset, MemoryEdge, MemoryNode, NodeType, TrackData
from .schemas import BoardCreate, BoardDetail, BoardRead, BoardUpdate, EdgeCreate, EdgeRead, MediaAssetRead, MediaAssetUpdate, NodeCreate, NodeRead, NodeUpdate, SpotifyTrackSearchResult

MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "./uploads"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 100 * 1024 * 1024))
ALLOWED_MEDIA = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"}
MEDIA_TYPES_BY_EXTENSION = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
}
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="MemoryBox API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
spotify_token: str | None = None
spotify_token_expires_at = 0.0


def initialise():
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    board_columns = {column["name"] for column in inspect(engine).get_columns("boards")}
    track_columns = {column["name"] for column in inspect(engine).get_columns("track_data")}
    node_columns = {column["name"] for column in inspect(engine).get_columns("memory_nodes")}
    with engine.begin() as connection:
        if "start_date" not in board_columns:
            connection.execute(text("ALTER TABLE boards ADD COLUMN start_date DATE"))
        if "end_date" not in board_columns:
            connection.execute(text("ALTER TABLE boards ADD COLUMN end_date DATE"))
        if "collapsed_item_limit" not in track_columns:
            connection.execute(text("ALTER TABLE track_data ADD COLUMN collapsed_item_limit INTEGER NOT NULL DEFAULT 3"))
        if "z_index" not in node_columns:
            connection.execute(text("ALTER TABLE memory_nodes ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0"))
    with Session(engine) as db:
        if not db.scalar(select(Board.id).limit(1)):
            db.add(Board(title="Июль 2026", year=2026, month=7, start_date=date(2026, 7, 1), end_date=date(2026, 7, 31)))
            db.commit()
        for board in db.scalars(select(Board).where(Board.start_date.is_(None) | Board.end_date.is_(None))).all():
            board.start_date = date(board.year, board.month, 1)
            board.end_date = date(board.year, board.month, calendar.monthrange(board.year, board.month)[1])
        db.commit()


@app.on_event("startup")
def startup():
    initialise()


app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")


def is_local_cover(path: str | None) -> bool:
    return bool(path and path.startswith("covers/"))


def remove_local_cover(path: str | None) -> None:
    if is_local_cover(path):
        (MEDIA_ROOT / path).unlink(missing_ok=True)


def cache_cover(url: str | None) -> str | None:
    """Download an external cover once, so the board does not depend on its source."""
    if not url or is_local_cover(url) or not url.startswith(("https://", "http://")):
        return url
    try:
        request = Request(url, headers={"User-Agent": "MemoryBox/1.0"})
        with urlopen(request, timeout=8) as response:
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                return url
            content = response.read(10 * 1024 * 1024 + 1)
        if not content or len(content) > 10 * 1024 * 1024:
            return url
    except (HTTPError, URLError, OSError, ValueError):
        return url
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(content_type, ".jpg")
    relative_path = f"covers/{uuid.uuid4().hex}{extension}"
    destination = MEDIA_ROOT / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return relative_path


def localise_track_covers(track: dict) -> dict:
    result = dict(track)
    for field in ("cover_url", "spotify_cover_url"):
        result[field] = cache_cover(result.get(field))
    result["playlist_items"] = [
        {**item, "cover_url": cache_cover(item.get("cover_url"))}
        for item in result.get("playlist_items", [])
    ]
    return result


def remove_track_covers(track: TrackData | None) -> None:
    if not track:
        return
    remove_local_cover(track.cover_url)
    remove_local_cover(track.spotify_cover_url)
    for item in track.playlist_items or []:
        remove_local_cover(item.get("cover_url"))


def board_or_404(board_id: int, db: Session) -> Board:
    board = db.get(Board, board_id)
    if not board:
        raise HTTPException(404, "Доска не найдена")
    return board


def node_or_404(node_id: int, db: Session) -> MemoryNode:
    node = db.execute(select(MemoryNode).options(joinedload(MemoryNode.media_assets), joinedload(MemoryNode.track_data)).where(MemoryNode.id == node_id)).unique().scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Узел не найден")
    return node


def spotify_access_token() -> str:
    global spotify_token, spotify_token_expires_at
    if spotify_token and time.time() < spotify_token_expires_at:
        return spotify_token
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(503, "Добавьте SPOTIFY_CLIENT_ID и SPOTIFY_CLIENT_SECRET в .env и перезапустите Docker Compose")
    try:
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        request = Request("https://accounts.spotify.com/api/token", data=b"grant_type=client_credentials", method="POST", headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/x-www-form-urlencoded"})
        with urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        spotify_token = payload["access_token"]
        spotify_token_expires_at = time.time() + max(int(payload.get("expires_in", 3600)) - 60, 60)
        return spotify_token
    except (HTTPError, URLError, KeyError, ValueError):
        raise HTTPException(502, "Spotify не выдал токен. Проверьте ключи приложения и подключение к интернету")


@app.get("/api/spotify/search", response_model=list[SpotifyTrackSearchResult])
def search_spotify_tracks(query: str = Query(min_length=2, max_length=200)):
    global spotify_token, spotify_token_expires_at
    token = spotify_access_token()
    endpoint = f"https://api.spotify.com/v1/search?{urlencode({'q': query, 'type': 'track', 'limit': 5})}"
    try:
        request = Request(endpoint, headers={"Authorization": f"Bearer {token}"})
        with urlopen(request, timeout=5) as response:
            items = json.loads(response.read().decode("utf-8")).get("tracks", {}).get("items", [])
    except HTTPError as error:
        if error.code == 401:
            spotify_token = None; spotify_token_expires_at = 0
        raise HTTPException(502, "Spotify временно недоступен. Попробуйте ещё раз")
    except (URLError, ValueError):
        raise HTTPException(502, "Не удалось выполнить поиск в Spotify")
    return [SpotifyTrackSearchResult(id=item["id"], title=item["name"], artist=", ".join(artist["name"] for artist in item.get("artists", [])), cover_url=(item.get("album", {}).get("images") or [{}])[0].get("url")) for item in items]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/board", response_model=BoardDetail)
def get_primary_board(db: Session = Depends(get_db)):
    statement = select(Board).options(joinedload(Board.nodes).joinedload(MemoryNode.media_assets), joinedload(Board.nodes).joinedload(MemoryNode.track_data), joinedload(Board.edges)).limit(1)
    board = db.execute(statement).unique().scalar_one_or_none()
    if not board:
        initialise()
        board = db.execute(statement).unique().scalar_one_or_none()
    return board


@app.get("/api/boards", response_model=list[BoardRead])
def list_boards(db: Session = Depends(get_db)):
    return db.scalars(select(Board).order_by(Board.start_date.desc(), Board.created_at.desc())).all()


@app.post("/api/boards", response_model=BoardRead, status_code=status.HTTP_201_CREATED)
def create_board(payload: BoardCreate, db: Session = Depends(get_db)):
    if payload.end_date < payload.start_date:
        raise HTTPException(422, "Конечная дата не может быть раньше начальной")
    board = Board(title=payload.title, year=payload.start_date.year, month=payload.start_date.month, start_date=payload.start_date, end_date=payload.end_date)
    db.add(board); db.commit(); db.refresh(board)
    return board


@app.get("/api/boards/{board_id}", response_model=BoardDetail)
def get_board(board_id: int, db: Session = Depends(get_db)):
    statement = select(Board).options(joinedload(Board.nodes).joinedload(MemoryNode.media_assets), joinedload(Board.nodes).joinedload(MemoryNode.track_data), joinedload(Board.edges)).where(Board.id == board_id)
    board = db.execute(statement).unique().scalar_one_or_none()
    if not board:
        raise HTTPException(404, "Доска не найдена")
    return board


@app.patch("/api/boards/{board_id}", response_model=BoardRead)
def update_board(board_id: int, payload: BoardUpdate, db: Session = Depends(get_db)):
    board = board_or_404(board_id, db)
    next_start = payload.start_date if payload.start_date is not None else board.start_date
    next_end = payload.end_date if payload.end_date is not None else board.end_date
    if next_end < next_start:
        raise HTTPException(422, "Конечная дата не может быть раньше начальной")
    if payload.title is not None:
        board.title = payload.title
    board.start_date = next_start
    board.end_date = next_end
    board.year = next_start.year
    board.month = next_start.month
    db.commit(); db.refresh(board)
    return board


@app.delete("/api/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(board_id: int, db: Session = Depends(get_db)):
    statement = select(Board).options(joinedload(Board.nodes).joinedload(MemoryNode.media_assets), joinedload(Board.nodes).joinedload(MemoryNode.track_data)).where(Board.id == board_id)
    board = db.execute(statement).unique().scalar_one_or_none()
    if not board:
        raise HTTPException(404, "Доска не найдена")
    for node in board.nodes:
        for asset in node.media_assets:
            for file_path in (asset.storage_path, asset.preview_path):
                if file_path:
                    (MEDIA_ROOT / file_path).unlink(missing_ok=True)
        remove_track_covers(node.track_data)
    db.delete(board)
    db.commit()


@app.post("/api/boards/{board_id}/nodes", response_model=NodeRead, status_code=status.HTTP_201_CREATED)
def create_node(board_id: int, payload: NodeCreate, db: Session = Depends(get_db)):
    board_or_404(board_id, db)
    node = MemoryNode(board_id=board_id, type=payload.type, title=payload.title, text_content=payload.text_content, position_x=payload.position_x, position_y=payload.position_y, z_index=payload.z_index, width=payload.width, height=payload.height, temporal_date=payload.temporal_date)
    if payload.type == NodeType.track:
        track = payload.track_data or {"title": payload.title}
        raw_track = track.model_dump() if hasattr(track, "model_dump") else track
        node.track_data = TrackData(**localise_track_covers(raw_track))
    db.add(node); db.commit()
    return node_or_404(node.id, db)


@app.patch("/api/nodes/{node_id}", response_model=NodeRead)
def update_node(node_id: int, payload: NodeUpdate, db: Session = Depends(get_db)):
    node = node_or_404(node_id, db)
    for field in ("title", "text_content", "position_x", "position_y", "z_index", "width", "height", "temporal_date"):
        if field in payload.model_fields_set:
            setattr(node, field, getattr(payload, field))
    if payload.track_data is not None:
        if node.type != NodeType.track:
            raise HTTPException(400, "Данные трека допустимы только для узла типа track")
        if not node.track_data:
            node.track_data = TrackData(node_id=node.id)
        next_track = localise_track_covers(payload.track_data.model_dump())
        previous_track = node.track_data.model_dump() if hasattr(node.track_data, "model_dump") else {
            "cover_url": node.track_data.cover_url,
            "spotify_cover_url": node.track_data.spotify_cover_url,
            "playlist_items": node.track_data.playlist_items,
        }
        for key, value in next_track.items():
            setattr(node.track_data, key, value)
        for field in ("cover_url", "spotify_cover_url"):
            if previous_track.get(field) != next_track.get(field):
                remove_local_cover(previous_track.get(field))
        previous_playlist_covers = {item.get("cover_url") for item in previous_track.get("playlist_items", [])}
        next_playlist_covers = {item.get("cover_url") for item in next_track.get("playlist_items", [])}
        for cover_path in previous_playlist_covers - next_playlist_covers:
            remove_local_cover(cover_path)
    db.commit()
    return node_or_404(node.id, db)


@app.get("/api/nodes/{node_id}", response_model=NodeRead)
def get_node(node_id: int, db: Session = Depends(get_db)):
    return node_or_404(node_id, db)


@app.delete("/api/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node(node_id: int, db: Session = Depends(get_db)):
    node = node_or_404(node_id, db)
    for asset in node.media_assets:
        for file_path in (asset.storage_path, asset.preview_path):
            if file_path:
                (MEDIA_ROOT / file_path).unlink(missing_ok=True)
    remove_track_covers(node.track_data)
    db.delete(node); db.commit()


@app.post("/api/nodes/{node_id}/media", response_model=MediaAssetRead, status_code=status.HTTP_201_CREATED)
def upload_media(node_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    node = node_or_404(node_id, db)
    if node.type != NodeType.media:
        raise HTTPException(400, "Медиа можно прикреплять только к медиа-узлу")
    extension = Path(file.filename or "upload").suffix.lower()
    content_type = (file.content_type or "").lower()
    detected_type = content_type if content_type in ALLOWED_MEDIA else MEDIA_TYPES_BY_EXTENSION.get(extension)
    if detected_type not in ALLOWED_MEDIA:
        raise HTTPException(415, "Поддерживаются JPEG, PNG, WebP, GIF, MP4, WebM и MOV")
    asset_id = uuid.uuid4().hex
    is_image = detected_type.startswith("image/")
    media_dir = MEDIA_ROOT / ("images" if is_image else "videos")
    media_dir.mkdir(parents=True, exist_ok=True)
    stored_relative = f"{'images' if is_image else 'videos'}/{asset_id}{extension}"
    destination = MEDIA_ROOT / stored_relative
    size = 0
    with destination.open("wb") as target:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                target.close(); destination.unlink(missing_ok=True)
                raise HTTPException(413, f"Файл больше допустимого лимита {MAX_UPLOAD_BYTES // 1024 // 1024} МБ")
            target.write(chunk)
    preview_path = None; width = height = None
    if is_image:
        try:
            with Image.open(destination) as image:
                width, height = image.size
                image.thumbnail((800, 800))
                thumb_rel = f"images/{asset_id}_thumb.jpg"
                image.convert("RGB").save(MEDIA_ROOT / thumb_rel, "JPEG", quality=85)
                preview_path = thumb_rel
        except UnidentifiedImageError:
            destination.unlink(missing_ok=True)
            raise HTTPException(400, "Файл не является корректным изображением")
    next_order = (max((asset.sort_order for asset in node.media_assets), default=-1) + 1)
    asset = MediaAsset(node_id=node.id, original_filename=file.filename or "upload", storage_path=stored_relative, mime_type=detected_type, size_bytes=size, preview_path=preview_path, width=width, height=height, sort_order=next_order)
    db.add(asset); db.commit(); db.refresh(asset)
    return asset


@app.patch("/api/media/{asset_id}", response_model=MediaAssetRead)
def update_media(asset_id: int, payload: MediaAssetUpdate, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(404, "Файл не найден")
    for field in ("sort_order", "is_favorite"):
        if field in payload.model_fields_set:
            setattr(asset, field, getattr(payload, field))
    db.commit(); db.refresh(asset)
    return asset


@app.delete("/api/media/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(asset_id: int, db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(404, "Файл не найден")
    for file_path in (asset.storage_path, asset.preview_path):
        if file_path:
            (MEDIA_ROOT / file_path).unlink(missing_ok=True)
    db.delete(asset); db.commit()


@app.post("/api/boards/{board_id}/edges", response_model=EdgeRead, status_code=status.HTTP_201_CREATED)
def create_edge(board_id: int, payload: EdgeCreate, db: Session = Depends(get_db)):
    board_or_404(board_id, db)
    if payload.source_node_id == payload.target_node_id:
        raise HTTPException(400, "Нельзя связать узел с самим собой")
    ids = set(db.scalars(select(MemoryNode.id).where(MemoryNode.board_id == board_id, MemoryNode.id.in_([payload.source_node_id, payload.target_node_id]))).all())
    if ids != {payload.source_node_id, payload.target_node_id}:
        raise HTTPException(400, "Оба узла должны принадлежать этой доске")
    existing = db.scalar(select(MemoryEdge).where(MemoryEdge.board_id == board_id, MemoryEdge.source_node_id == payload.source_node_id, MemoryEdge.target_node_id == payload.target_node_id))
    if existing:
        return existing
    edge = MemoryEdge(board_id=board_id, **payload.model_dump())
    db.add(edge); db.commit(); db.refresh(edge)
    return edge


@app.delete("/api/edges/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_edge(edge_id: int, db: Session = Depends(get_db)):
    edge = db.get(MemoryEdge, edge_id)
    if not edge:
        raise HTTPException(404, "Связь не найдена")
    db.delete(edge); db.commit()
