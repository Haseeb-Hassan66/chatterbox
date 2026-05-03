from fastapi import APIRouter, HTTPException
from database import groups_col, users_col, messages_col
from models.group import CreateGroupModel
from bson import ObjectId
from datetime import datetime, timezone

router = APIRouter()

def serialize_group(g):
    return {
        "id": str(g["_id"]),
        "name": g["name"],
        "admin": str(g["admin"]),
        "members": [str(m) for m in g.get("members", [])],
        "createdAt": g["createdAt"].isoformat()
    }

@router.post("/create")
async def create_group(body: CreateGroupModel):
    member_ids = [ObjectId(m) for m in body.members]
    if ObjectId(body.adminId) not in member_ids:
        member_ids.append(ObjectId(body.adminId))
    group = {
        "name": body.name,
        "admin": ObjectId(body.adminId),
        "members": member_ids,
        "createdAt": datetime.now(timezone.utc)
    }
    result = await groups_col.insert_one(group)
    return {"message": "Group created", "id": str(result.inserted_id)}

@router.get("/user/{user_id}")
async def get_user_groups(user_id: str):
    groups = []
    async for g in groups_col.find({"members": ObjectId(user_id)}):
        groups.append(serialize_group(g))
    return groups

@router.get("/{group_id}/messages")
async def get_messages(group_id: str):
    msgs = []
    cursor = messages_col.find(
        {"groupId": ObjectId(group_id)},
        sort=[("createdAt", -1)],
        limit=50
    )
    async for m in cursor:
        msgs.append({
            "_id": str(m["_id"]),
            "groupId": str(m["groupId"]),
            "senderId": str(m["senderId"]),
            "content": m["content"],
            "readBy": [str(r) for r in m.get("readBy", [])],
            "deleteMode": m.get("deleteMode", "manual"),
            "expiresAt": m["expiresAt"].isoformat() if m.get("expiresAt") else None,
            "createdAt": m["createdAt"].isoformat()
        })
    msgs.reverse()
    return msgs

@router.get("/{group_id}/search")
async def search_messages(group_id: str, q: str):
    msgs = []
    async for m in messages_col.find({
        "groupId": ObjectId(group_id),
        "$text": {"$search": q}
    }):
        msgs.append({
            "_id": str(m["_id"]),
            "senderId": str(m["senderId"]),
            "content": m["content"],
            "createdAt": m["createdAt"].isoformat()
        })
    return msgs