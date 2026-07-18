from io import BytesIO


def board(client):
    response = client.get("/api/board")
    assert response.status_code == 200
    return response.json()


def test_initial_board_and_node_crud(client):
    current = board(client)
    assert current["title"] == "Июль 2026"
    created = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "note", "title": "Прогулка", "text_content": "Тёплый вечер", "position_x": 120, "position_y": 80, "temporal_date": "2026-07-17"})
    assert created.status_code == 201
    node = created.json()
    assert node["show_type_label"] is False
    assert node["show_date"] is True
    assert node["date_position"] == "bottom-center"
    changed = client.patch(f"/api/nodes/{node['id']}", json={"position_x": 333, "z_index": 12, "width": 420, "height": 260, "title": "Вечерняя прогулка", "show_date": False, "show_type_label": True, "date_position": "top-left"})
    assert changed.status_code == 200
    assert changed.json()["position_x"] == 333
    assert changed.json()["z_index"] == 12
    assert changed.json()["width"] == 420
    assert changed.json()["height"] == 260
    assert changed.json()["title"] == "Вечерняя прогулка"
    assert changed.json()["show_type_label"] is True
    assert changed.json()["show_date"] is False
    assert changed.json()["date_position"] == "top-left"


def test_create_and_list_boards(client):
    created = client.post("/api/boards", json={"title": "Август 2026", "start_date": "2026-08-01", "end_date": "2026-08-12"})
    assert created.status_code == 201
    board_id = created.json()["id"]
    listed = client.get("/api/boards").json()
    assert any(item["id"] == board_id for item in listed)
    detail = client.get(f"/api/boards/{board_id}")
    assert detail.status_code == 200
    assert detail.json()["nodes"] == []


def test_update_board_period_and_title(client):
    created = client.post("/api/boards", json={"title": "Summer", "start_date": "2026-07-01", "end_date": "2026-07-31"}).json()
    changed = client.patch(f"/api/boards/{created['id']}", json={"title": "Long summer", "end_date": "2026-08-15"})
    assert changed.status_code == 200
    assert changed.json()["title"] == "Long summer"
    assert changed.json()["start_date"] == "2026-07-01"
    assert changed.json()["end_date"] == "2026-08-15"
    invalid = client.patch(f"/api/boards/{created['id']}", json={"start_date": "2026-09-01"})
    assert invalid.status_code == 422


def test_delete_board(client):
    created = client.post("/api/boards", json={"title": "Temporary", "start_date": "2026-07-01", "end_date": "2026-07-01"}).json()
    assert client.delete(f"/api/boards/{created['id']}").status_code == 204
    assert client.get(f"/api/boards/{created['id']}").status_code == 404


def test_edges_and_safe_node_deletion(client):
    current = board(client)
    first = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "note"}).json()
    second = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "track", "track_data": {"kind": "playlist", "title": "July", "collapsed_item_limit": 2, "playlist_items": [{"title": "Song", "artist": "Artist", "is_favorite": True}, {"title": "Another", "artist": "Artist", "is_favorite": False}]}}).json()
    assert len(second["track_data"]["playlist_items"]) == 2
    assert second["track_data"]["collapsed_item_limit"] == 2
    assert second["track_data"]["playlist_items"][0]["is_favorite"] is True
    edge = client.post(f"/api/boards/{current['id']}/edges", json={"source_node_id": first["id"], "target_node_id": second["id"], "source_handle": "right", "target_handle": "right"})
    assert edge.status_code == 201
    assert edge.json()["source_handle"] == "right"
    assert edge.json()["target_handle"] == "right"
    assert client.delete(f"/api/nodes/{first['id']}").status_code == 204
    assert all(item["id"] != edge.json()["id"] for item in board(client)["edges"])


def test_spotify_search_explains_missing_configuration(client, monkeypatch):
    monkeypatch.delenv("SPOTIFY_CLIENT_ID", raising=False)
    monkeypatch.delenv("SPOTIFY_CLIENT_SECRET", raising=False)
    response = client.get("/api/spotify/search", params={"query": "Radiohead"})
    assert response.status_code == 503
    assert "SPOTIFY_CLIENT_ID" in response.json()["detail"]


def test_track_covers_are_saved_in_local_media_volume(client, monkeypatch):
    from email.message import Message
    import app.main as main

    class CoverResponse:
        def __init__(self):
            self.headers = Message()
            self.headers["Content-Type"] = "image/png"
        def read(self, _limit): return b"local-cover"
        def __enter__(self): return self
        def __exit__(self, *_args): return False

    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: CoverResponse())
    current = board(client)
    created = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "track", "track_data": {"title": "Song", "artist": "Artist", "spotify_cover_url": "https://cdn.spotify.test/cover.png", "playlist_items": [{"title": "Playlist song", "cover_url": "https://cdn.spotify.test/item.png"}]}})
    assert created.status_code == 201
    track = created.json()["track_data"]
    assert track["spotify_cover_url"].startswith("covers/")
    assert track["playlist_items"][0]["cover_url"].startswith("covers/")
    assert (main.MEDIA_ROOT / track["spotify_cover_url"]).exists()


def test_upload_image(client):
    current = board(client)
    node = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "media", "title": "Закат"}).json()
    from PIL import Image
    image = Image.new("RGB", (16, 10), "purple")
    binary = BytesIO(); image.save(binary, format="PNG")
    uploaded = client.post(f"/api/nodes/{node['id']}/media", files={"file": ("Летний вечер 01.png", binary.getvalue(), "image/png")})
    assert uploaded.status_code == 201
    assert uploaded.json()["preview_path"]


def test_multiple_media_uploads(client):
    current = board(client)
    node = client.post(f"/api/boards/{current['id']}/nodes", json={"type": "media", "title": "Короткий момент", "width": 300, "height": 260}).json()
    from PIL import Image
    image = Image.new("RGB", (12, 12), "teal")
    binary = BytesIO(); image.save(binary, format="PNG")
    uploaded_image = client.post(f"/api/nodes/{node['id']}/media", files={"file": ("one.png", binary.getvalue(), "image/png")})
    assert uploaded_image.status_code == 201
    video = client.post(f"/api/nodes/{node['id']}/media", files={"file": ("moment.mp4", b"not-transcoded-in-mvp", "application/octet-stream")})
    assert video.status_code == 201
    assert video.json()["mime_type"] == "video/mp4"
    saved = next(item for item in board(client)["nodes"] if item["id"] == node["id"])
    assert len(saved["media_assets"]) == 2
