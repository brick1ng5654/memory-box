import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path / "uploads"))
    import app.database as database
    import app.main as main
    database.engine.dispose()
    from sqlalchemy import create_engine
    database.engine = create_engine(os.environ["DATABASE_URL"], connect_args={"check_same_thread": False})
    from sqlalchemy import event
    @event.listens_for(database.engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")
    database.SessionLocal.configure(bind=database.engine)
    main.engine = database.engine
    main.MEDIA_ROOT = Path(os.environ["MEDIA_ROOT"])
    main.initialise()
    with TestClient(main.app) as test_client:
        yield test_client
