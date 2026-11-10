"""AimRabs: a minimal same-origin API and static frontend server."""

from pathlib import Path
import os
import sqlite3
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DURATION_SECONDS = 60
MAX_SCORE = 6000  # Sanity cap, not proof of valid clicks.
BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE = Path(
    os.environ.get(
        "DB_PATH",
        str(BASE_DIR / "backend" / "aimrabs.sqlite3")
    )
)
FRONTEND = BASE_DIR / "frontend"

app = FastAPI(title="AimRabs API")


def connect_db():
    connection = sqlite3.connect(DATABASE, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def initialize_db():
    connection = connect_db()
    try:
        connection.execute("PRAGMA journal_mode = WAL")
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS game_sessions (
                    id TEXT PRIMARY KEY,
                    nickname TEXT NOT NULL,
                    started_at REAL NOT NULL,
                    finished_at REAL,
                    score INTEGER,
                    status TEXT NOT NULL CHECK(status IN ('playing', 'finished'))
                )
            """)
            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_game_ranking
                ON game_sessions(status, score DESC, finished_at ASC)
            """)
    finally:
        connection.close()


initialize_db()


class StartRequest(BaseModel):
    nickname: str


class FinishRequest(BaseModel):
    score: int = Field(ge=0, le=MAX_SCORE, strict=True)


def rank_of(connection, session_id):
    row = connection.execute("""
        SELECT rank FROM (
            SELECT id, ROW_NUMBER() OVER (
                ORDER BY score DESC, finished_at ASC, id ASC
            ) AS rank
            FROM game_sessions WHERE status = 'finished'
        ) WHERE id = ?
    """, (session_id,)).fetchone()
    return row["rank"] if row else None


@app.post("/api/games/start")
def start_game(payload: StartRequest):
    nickname = payload.nickname.strip()
    if not 1 <= len(nickname) <= 16:
        raise HTTPException(status_code=422, detail="닉네임은 1~16자로 입력하세요.")

    session_id = str(uuid4())
    connection = connect_db()
    try:
        with connection:
            connection.execute("""
                INSERT INTO game_sessions(id, nickname, started_at, status)
                VALUES (?, ?, ?, 'playing')
            """, (session_id, nickname, time.time()))
    finally:
        connection.close()
    return {"session_id": session_id, "duration_seconds": DURATION_SECONDS}


@app.post("/api/games/{session_id}/finish")
def finish_game(session_id: str, payload: FinishRequest):
    connection = connect_db()
    try:
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            game = connection.execute(
                "SELECT * FROM game_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if game is None:
                raise HTTPException(status_code=404, detail="존재하지 않는 게임입니다.")
            if game["status"] == "finished":
                if game["score"] != payload.score:
                    raise HTTPException(status_code=409, detail="이미 다른 점수로 종료된 게임입니다.")
                # Same score can be safely retried after a lost network response.
                return {"score": game["score"], "rank": rank_of(connection, session_id)}

            now = time.time()
            if now - game["started_at"] < DURATION_SECONDS:
                raise HTTPException(status_code=409, detail="아직 60초가 지나지 않았습니다.")

            connection.execute("""
                UPDATE game_sessions
                SET status = 'finished', finished_at = ?, score = ?
                WHERE id = ?
            """, (now, payload.score, session_id))
            rank = rank_of(connection, session_id)
            return {"score": payload.score, "rank": rank}
    finally:
        connection.close()


@app.get("/api/games/{session_id}/result")
def game_result(session_id: str):
    connection = connect_db()
    try:
        game = connection.execute(
            "SELECT * FROM game_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if game is None:
            raise HTTPException(status_code=404, detail="존재하지 않는 게임입니다.")
        if game["status"] != "finished":
            raise HTTPException(status_code=409, detail="진행 중인 게임입니다.")
        return {"score": game["score"], "rank": rank_of(connection, session_id)}
    finally:
        connection.close()


@app.get("/api/leaderboard")
def leaderboard():
    connection = connect_db()
    try:
        records = connection.execute("""
            SELECT id, nickname, score FROM game_sessions
            WHERE status = 'finished'
            ORDER BY score DESC, finished_at ASC, id ASC
            LIMIT 10
        """).fetchall()
        return {"items": [
            {"rank": index, "nickname": item["nickname"],
             "score": item["score"], "session_id": item["id"]}
            for index, item in enumerate(records, start=1)
        ]}
    finally:
        connection.close()


# Keep this mount LAST, so it cannot intercept /api routes.
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
