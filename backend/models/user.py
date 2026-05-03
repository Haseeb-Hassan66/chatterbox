from pydantic import BaseModel
from typing import Optional

class RegisterModel(BaseModel):
    username: str
    password: str

class LoginModel(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    isOnline: bool