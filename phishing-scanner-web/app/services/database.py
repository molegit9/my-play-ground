import sqlite3
import os
from contextlib import contextmanager
from app.core.config import settings

# Extract DB path from URL like sqlite:///./security_logs.db
DB_PATH = settings.DATABASE_URL.replace("sqlite:///", "")

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS security_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                raw_data TEXT
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS email_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT, 
                sender TEXT, 
                subject TEXT,
                is_phishing BOOLEAN, 
                risk_level TEXT, 
                summary TEXT,
                rag_used BOOLEAN DEFAULT 0,
                rag_doc_count INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                raw_data TEXT
            )
        ''')
        
        # Upgrade existing database if columns don't exist
        for col_def in [
            "ALTER TABLE email_logs ADD COLUMN rag_used BOOLEAN DEFAULT 0",
            "ALTER TABLE email_logs ADD COLUMN rag_doc_count INTEGER DEFAULT 0",
            "ALTER TABLE email_logs ADD COLUMN raw_data TEXT",
            "ALTER TABLE security_logs ADD COLUMN raw_data TEXT",
        ]:
            try:
                conn.execute(col_def)
            except Exception:
                pass  # Ignore if already exists

@contextmanager
def get_db():
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
        
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.commit()
        conn.close()

def log_analysis(action_type: str, content: str, status: str, reason: str, raw_data: str = None):
    with get_db() as conn:
        conn.execute(
            '''INSERT INTO security_logs (action_type, content, status, reason, raw_data) 
               VALUES (?, ?, ?, ?, ?)''',
            (action_type, content, status, reason, raw_data)
        )

def get_cached_analysis(content: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''SELECT status, reason FROM security_logs WHERE content = ? ORDER BY timestamp DESC LIMIT 1''',
            (content,)
        )
        row = cursor.fetchone()
        if row:
            return {"status": row[0], "reason": row[1]}
    return None

def get_cached_email_analysis(message_id: str):
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            '''SELECT raw_data FROM email_logs WHERE message_id = ? ORDER BY timestamp DESC LIMIT 1''',
            (message_id,)
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
    return None

def log_email_analysis(
    message_id: str, sender: str, subject: str,
    is_phishing: bool, risk_level: str, summary: str,
    rag_used: bool = False, rag_doc_count: int = 0,
    raw_data: str = None
):
    with get_db() as conn:
        conn.execute(
            '''INSERT INTO email_logs
               (message_id, sender, subject, is_phishing, risk_level, summary, rag_used, rag_doc_count, raw_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (message_id, sender, subject, is_phishing, risk_level, summary, rag_used, rag_doc_count, raw_data)
        )

def get_recent_logs(limit: int = 20) -> list[dict]:
    with get_db() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = '''
            SELECT 
                'email' as type,
                id,
                message_id,
                sender,
                subject,
                is_phishing,
                NULL as status,
                risk_level,
                summary,
                NULL as reason,
                timestamp,
                NULL as action_type,
                NULL as content
            FROM email_logs
            
            UNION ALL
            
            SELECT
                'url' as type,
                id,
                NULL as message_id,
                NULL as sender,
                NULL as subject,
                NULL as is_phishing,
                status,
                NULL as risk_level,
                NULL as summary,
                reason,
                timestamp,
                action_type,
                content
            FROM security_logs
            
            ORDER BY timestamp DESC
            LIMIT ?
        '''
        
        cursor.execute(query, (limit,))
        rows = cursor.fetchall()
        
        result = []
        for row in rows:
            d = dict(row)
            if d['type'] == 'email':
                d['is_phishing'] = bool(d['is_phishing'])
            result.append(d)
            
        return result
