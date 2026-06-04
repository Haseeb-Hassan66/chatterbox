from fastapi import APIRouter, HTTPException
from database import users_col
from models.user import RegisterModel, LoginModel
import bcrypt
from jose import jwt
import os
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from bson.errors import InvalidId

router = APIRouter()

def to_oid(value: str) -> ObjectId:
    """Convert string to ObjectId, raising HTTP 400 on invalid format."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid ID format: '{value}'")

def serialize_user(user):
    return {
        "id": str(user["_id"]),
        "username": user["username"],
        "isOnline": user.get("isOnline", False),
        "lastSeen": user.get("lastSeen", "").isoformat() if user.get("lastSeen") else None
    }

@router.post("/register")
async def register(body: RegisterModel):
    existing = await users_col.find_one({"username": body.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt())
    user = {
        "username": body.username,
        "password": hashed.decode(),
        "isOnline": False,
        "lastSeen": datetime.now(timezone.utc),
        "createdAt": datetime.now(timezone.utc)
    }
    result = await users_col.insert_one(user)
    return {"message": "User registered successfully", "id": str(result.inserted_id)}

@router.post("/login")
async def login(body: LoginModel):
    user = await users_col.find_one({"username": body.username})
    if not user or not bcrypt.checkpw(body.password.encode(), user["password"].encode()):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    secret = os.getenv("JWT_SECRET")
    token = jwt.encode(
        {
            "sub": str(user["_id"]),
            "username": user["username"],
            "exp": datetime.now(timezone.utc) + timedelta(days=7)
        },
        secret,
        algorithm="HS256"
    )
    return {
        "token": token,
        "user": serialize_user(user)
    }

@router.get("/users")
async def get_all_users():
    users = []
    async for user in users_col.find({}, {"password": 0}):
        users.append(serialize_user(user))
    return users

@router.get("/users/{user_id}")
async def get_user(user_id: str):
    user = await users_col.find_one({"_id": to_oid(user_id)}, {"password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_user(user)