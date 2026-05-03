from pydantic import BaseModel
from typing import Optional

class SendMessageModel(BaseModel):
    groupId: str
    senderId: str
    content: str
    deleteMode: str = "manual"  # "manual" | "24h" | "7d"