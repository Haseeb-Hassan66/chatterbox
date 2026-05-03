from pydantic import BaseModel
from typing import List

class CreateGroupModel(BaseModel):
    name: str
    adminId: str
    members: List[str] = []