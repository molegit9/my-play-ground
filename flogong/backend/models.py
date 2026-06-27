from sqlalchemy import Column, Integer, String, BigInteger, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nickname = Column(String(30), unique=True, nullable=False, index=True)
    wins = Column(Integer, default=0, nullable=False)
    max_survival_ms = Column(BigInteger, default=0, nullable=False)

    # Relationships
    rooms_as_p1 = relationship("GameRoom", foreign_keys="[GameRoom.player1_id]", back_populates="player1")
    rooms_as_p2 = relationship("GameRoom", foreign_keys="[GameRoom.player2_id]", back_populates="player2")

class GameRoom(Base):
    __tablename__ = "game_rooms"

    room_id = Column(String(36), primary_key=True)  # UUID
    room_name = Column(String(50), nullable=False)
    player1_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    player2_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(20), default="WAITING", nullable=False)  # 'WAITING', 'PLAYING', 'FINISHED'
    is_private = Column(Boolean, default=False, nullable=False)
    invite_code = Column(String(6), unique=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    player1 = relationship("User", foreign_keys=[player1_id], back_populates="rooms_as_p1")
    player2 = relationship("User", foreign_keys=[player2_id], back_populates="rooms_as_p2")

class MatchResult(Base):
    __tablename__ = "match_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(36), nullable=False)
    winner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    loser_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    winner_survival_ms = Column(BigInteger, nullable=False)
    played_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    winner = relationship("User", foreign_keys=[winner_id])
    loser = relationship("User", foreign_keys=[loser_id])
