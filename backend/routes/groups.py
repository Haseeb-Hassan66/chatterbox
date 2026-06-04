from fastapi import APIRouter, HTTPException, Depends
from database import groups_col, users_col, messages_col
from models.group import CreateGroupModel
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timezone

from dependencies import get_current_user

router = APIRouter()

def to_oid(value: str) -> ObjectId:
    """Convert a string to ObjectId, raising HTTP 400 on invalid format."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid ID format: '{value}'")

def serialize_group(g):
    return {
        "id": str(g["_id"]),
        "name": g["name"],
        "admin": str(g["admin"]),
        "members": [str(m) for m in g.get("members", [])],
        "isDM": g.get("isDM", False),
        "createdAt": g["createdAt"].isoformat()
    }

@router.post("/create")
async def create_group(body: CreateGroupModel, current_user = Depends(get_current_user)):
    admin_oid = to_oid(body.adminId)
    member_ids = [to_oid(m) for m in body.members]
    if admin_oid not in member_ids:
        member_ids.append(admin_oid)
    group = {
        "name": body.name,
        "admin": admin_oid,
        "members": member_ids,
        "isDM": body.isDM,
        "createdAt": datetime.now(timezone.utc)
    }
    result = await groups_col.insert_one(group)
    return {"message": "Group created", "id": str(result.inserted_id)}

@router.get("/user/{user_id}")
async def get_user_groups(user_id: str, current_user = Depends(get_current_user)):
    groups = []
    user_oid = to_oid(user_id)
    async for g in groups_col.find({"members": user_oid}):
        data = serialize_group(g)
        last_msg = await messages_col.find_one(
            {"groupId": g["_id"]},
            sort=[("createdAt", -1)]
        )
        if last_msg:
            data["lastMessage"] = {
                "content":    last_msg["content"],
                "senderName": last_msg.get("senderName", ""),
                "createdAt":  last_msg["createdAt"].isoformat()
            }
        else:
            data["lastMessage"] = None
        
        unread_count = await messages_col.count_documents({
            "groupId": g["_id"],
            "readBy": {"$ne": user_oid}
        })
        data["unreadCount"] = unread_count

        groups.append(data)
    groups.sort(
        key=lambda x: x["lastMessage"]["createdAt"] if x["lastMessage"] else x["createdAt"],
        reverse=True
    )
    return groups

@router.get("/{group_id}/messages")
async def get_messages(group_id: str, current_user = Depends(get_current_user)):
    msgs = []
    cursor = messages_col.find(
        {"groupId": to_oid(group_id)}
    ).sort("createdAt", -1).limit(50)
    async for m in cursor:
        msgs.append({
            "_id":        str(m["_id"]),
            "groupId":    str(m["groupId"]),
            "senderId":   str(m["senderId"]),
            "senderName": m.get("senderName", "Unknown"),
            "content":    m["content"],
            "readBy":     [str(r) for r in m.get("readBy", [])],
            "deleteMode": m.get("deleteMode", "manual"),
            "expiresAt":  m["expiresAt"].isoformat() if m.get("expiresAt") else None,
            "createdAt":  m["createdAt"].isoformat()
        })
    msgs.reverse()
    return msgs

@router.get("/{group_id}/search")
async def search_messages(group_id: str, q: str, current_user = Depends(get_current_user)):
    msgs = []
    async for m in messages_col.find({
        "groupId": to_oid(group_id),
        "$text": {"$search": q}
    }):
        msgs.append({
            "_id":        str(m["_id"]),
            "senderId":   str(m["senderId"]),
            "senderName": m.get("senderName", "Unknown"),
            "content":    m["content"],
            "createdAt":  m["createdAt"].isoformat()
        })
    return msgs

@router.get("/dm/{user_a}/{user_b}")
async def get_dm_group(user_a: str, user_b: str, current_user = Depends(get_current_user)):
    """Find an existing DM group between exactly these two users."""
    a_id = to_oid(user_a)
    b_id = to_oid(user_b)
    g = await groups_col.find_one({
        "isDM": True,
        "members": {"$all": [a_id, b_id], "$size": 2}
    })
    if not g:
        raise HTTPException(status_code=404, detail="No DM group found")
    return serialize_group(g)