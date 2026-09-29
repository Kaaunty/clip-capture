"""SQLite persistence for local events, clips, and command deduplication."""

from pathlib import Path
import sqlite3
import threading
import time
from typing import Any


class LocalQueueDB:
    """Manages SQLite storage for events, clips, and recent triggers."""

    def __init__(self, db_path: Path | str = ":memory:"):
        self.db_path = str(db_path)
        self._lock = threading.Lock()

        # Ensure parent directory exists if using a file path
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

        # Enable WAL and foreign keys
        with self._lock:
            with self.conn:
                if self.db_path != ":memory:":
                    self.conn.execute("PRAGMA journal_mode = WAL;")
                self.conn.execute("PRAGMA foreign_keys = ON;")
                self._init_tables()

    def _init_tables(self) -> None:
        """Create events, clips, and recent_commands tables."""
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                command_id TEXT UNIQUE,
                field_id TEXT NOT NULL,
                trigger_source TEXT NOT NULL,
                trigger_ts REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clips (
                clip_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                camera_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                duration REAL NOT NULL DEFAULT 0.0,
                sha256 TEXT,
                status TEXT NOT NULL DEFAULT 'EXTRACTED',
                attempts INTEGER NOT NULL DEFAULT 0,
                next_retry_at REAL NOT NULL DEFAULT 0.0,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE
            );
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS recent_commands (
                command_id TEXT PRIMARY KEY,
                field_id TEXT NOT NULL,
                trigger_source TEXT NOT NULL,
                trigger_ts REAL NOT NULL,
                received_at REAL NOT NULL,
                event_id TEXT NOT NULL
            );
            """
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_clips_event_id ON clips(event_id);")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status);")
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_recent_commands_lookup "
            "ON recent_commands(field_id, trigger_source, trigger_ts);"
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_events_command_id ON events(command_id);")

    def record_event(
        self,
        event_id: str,
        command_id: str,
        field_id: str,
        trigger_source: str,
        trigger_ts: float,
        status: str = "QUEUED",
    ) -> None:
        """Insert a newly queued event and record it in recent commands."""
        now = time.time()
        with self._lock:
            with self.conn:
                self.conn.execute(
                    """
                    INSERT INTO events (
                        event_id, command_id, field_id, trigger_source, trigger_ts, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (event_id, command_id, field_id, trigger_source, trigger_ts, status, now, now),
                )
                self.conn.execute(
                    """
                    INSERT OR REPLACE INTO recent_commands (
                        command_id, field_id, trigger_source, trigger_ts, received_at, event_id
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (command_id, field_id, trigger_source, trigger_ts, now, event_id),
                )

    def get_event(self, event_id: str) -> dict[str, Any] | None:
        """Fetch an event record by ID."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("SELECT * FROM events WHERE event_id = ?", (event_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_event_by_command_id(self, command_id: str) -> dict[str, Any] | None:
        """Fetch an event record by command ID."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("SELECT * FROM events WHERE command_id = ?", (command_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_event_status(self, event_id: str, status: str) -> None:
        """Update event status."""
        now = time.time()
        with self._lock:
            with self.conn:
                self.conn.execute(
                    "UPDATE events SET status = ?, updated_at = ? WHERE event_id = ?",
                    (status, now, event_id),
                )

    def add_clip(
        self,
        clip_id: str,
        event_id: str,
        camera_id: str,
        file_path: str,
        duration: float = 0.0,
        status: str = "EXTRACTED",
        sha256: str | None = None,
        attempts: int = 0,
        next_retry_at: float = 0.0,
        error: str | None = None,
    ) -> None:
        """Store a clip metadata record associated with an event."""
        now = time.time()
        with self._lock:
            with self.conn:
                self.conn.execute(
                    """
                    INSERT INTO clips (
                        clip_id, event_id, camera_id, file_path, duration, sha256,
                        status, attempts, next_retry_at, error, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        clip_id,
                        event_id,
                        camera_id,
                        file_path,
                        float(duration),
                        sha256,
                        status,
                        attempts,
                        float(next_retry_at),
                        error,
                        now,
                        now,
                    ),
                )

    def get_clip(self, clip_id: str) -> dict[str, Any] | None:
        """Fetch a clip record by ID."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("SELECT * FROM clips WHERE clip_id = ?", (clip_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_clips_by_event(self, event_id: str) -> list[dict[str, Any]]:
        """Fetch all clips associated with an event."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("SELECT * FROM clips WHERE event_id = ? ORDER BY created_at ASC", (event_id,))
            return [dict(row) for row in cursor.fetchall()]

    def update_clip_status(
        self,
        clip_id: str,
        status: str,
        attempts: int | None = None,
        next_retry_at: float | None = None,
        error: str | None = None,
        sha256: str | None = None,
    ) -> None:
        """Update status, retries, and checksum for a clip."""
        now = time.time()
        with self._lock:
            fields = ["status = ?", "updated_at = ?"]
            params: list[Any] = [status, now]

            if attempts is not None:
                fields.append("attempts = ?")
                params.append(attempts)
            if next_retry_at is not None:
                fields.append("next_retry_at = ?")
                params.append(float(next_retry_at))
            if error is not None:
                fields.append("error = ?")
                params.append(error)
            if sha256 is not None:
                fields.append("sha256 = ?")
                params.append(sha256)

            params.append(clip_id)
            query = f"UPDATE clips SET {', '.join(fields)} WHERE clip_id = ?"
            with self.conn:
                self.conn.execute(query, params)

    def reset_stale_processing_jobs(self, timeout_seconds: float = 300.0) -> int:
        """Reset clips left in PROCESSING status back to EXTRACTED.

        If timeout_seconds <= 0, resets all PROCESSING clips immediately (e.g. on agent reboot).
        If timeout_seconds > 0, resets clips updated_at <= (now - timeout_seconds).
        Returns number of affected clip rows.
        """
        now = time.time()
        with self._lock:
            with self.conn:
                if timeout_seconds <= 0:
                    cursor = self.conn.execute(
                        """
                        UPDATE clips
                        SET status = 'EXTRACTED', updated_at = ?
                        WHERE status = 'PROCESSING'
                        """,
                        (now,),
                    )
                else:
                    cutoff = now - float(timeout_seconds)
                    cursor = self.conn.execute(
                        """
                        UPDATE clips
                        SET status = 'EXTRACTED', updated_at = ?
                        WHERE status = 'PROCESSING' AND updated_at <= ?
                        """,
                        (now, cutoff),
                    )
                return cursor.rowcount

    def get_pending_clips(self, now: float | None = None) -> list[dict[str, Any]]:
        """Retrieve clips requiring upload (QUEUED, EXTRACTED, or ready retry FAILED)."""
        current_ts = now if now is not None else time.time()
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute(
                """
                SELECT * FROM clips
                WHERE status != 'UPLOADED'
                  AND (status IN ('QUEUED', 'EXTRACTED') OR (status = 'FAILED' AND next_retry_at <= ?))
                ORDER BY created_at ASC
                """,
                (current_ts,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def is_duplicate_command(self, command_id: str) -> bool:
        """Check if command_id has already been recorded."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute("SELECT 1 FROM recent_commands WHERE command_id = ?", (command_id,))
            if cursor.fetchone():
                return True
            cursor.execute("SELECT 1 FROM events WHERE command_id = ?", (command_id,))
            return cursor.fetchone() is not None

    def is_recent_button_trigger(
        self, field_id: str, trigger_ts: float, window_seconds: float = 3.0
    ) -> bool:
        """Check if a button press on the same field occurred within window_seconds using range check."""
        with self._lock:
            cursor = self.conn.cursor()
            cursor.execute(
                """
                SELECT 1 FROM recent_commands
                WHERE field_id = ?
                  AND UPPER(trigger_source) LIKE '%BUTTON%'
                  AND trigger_ts BETWEEN (? - ?) AND (? + ?)
                LIMIT 1
                """,
                (field_id, trigger_ts, window_seconds, trigger_ts, window_seconds),
            )
            return cursor.fetchone() is not None

    def check_duplicate(
        self,
        command_id: str,
        field_id: str,
        trigger_source: str,
        trigger_ts: float,
        window_seconds: float = 3.0,
    ) -> tuple[bool, str | None, str | None]:
        """Check both command_id uniqueness and button debounce with window range check.

        Returns (is_duplicate, reason, existing_event_id).
        """
        with self._lock:
            cursor = self.conn.cursor()
            # 1. Check recent_commands by command_id
            cursor.execute(
                "SELECT event_id FROM recent_commands WHERE command_id = ?",
                (command_id,),
            )
            row = cursor.fetchone()
            if row:
                return True, f"Command {command_id} already processed", row["event_id"]

            # 2. Check events table by command_id
            cursor.execute(
                "SELECT event_id FROM events WHERE command_id = ?",
                (command_id,),
            )
            row = cursor.fetchone()
            if row:
                return True, f"Command {command_id} already processed", row["event_id"]

            # 3. Check button debounce window range
            if "BUTTON" in trigger_source.upper():
                cursor.execute(
                    """
                    SELECT event_id FROM recent_commands
                    WHERE field_id = ?
                      AND UPPER(trigger_source) LIKE '%BUTTON%'
                      AND trigger_ts BETWEEN (? - ?) AND (? + ?)
                    ORDER BY trigger_ts DESC LIMIT 1
                    """,
                    (field_id, trigger_ts, window_seconds, trigger_ts, window_seconds),
                )
                btn_row = cursor.fetchone()
                if btn_row:
                    return (
                        True,
                        f"Button trigger debounced within {window_seconds}s",
                        btn_row["event_id"],
                    )

        return False, None, None

    def close(self) -> None:
        """Close SQLite connection."""
        with self._lock:
            self.conn.close()
