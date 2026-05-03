from datetime import datetime, timezone, timedelta
from bson import ObjectId
from database import messages_col, users_col

DELETE_DURATIONS = {
    "manual": None,
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7)
}

def register_socket_events(sio):

    @sio.event
    async def connect(sid, environ, auth):
        print(f"Client connected: {sid}")

    @sio.event
    async def disconnect(sid):
        print(f"Client disconnected: {sid}")

    @sio.event
    async def set_online(sid, data):
        user_id = data.get("userId")
        if user_id:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": True, "lastSeen": datetime.now(timezone.utc)}}
            )
            await sio.broadcast.emit("user_status", {"userId": user_id, "isOnline": True})

    @sio.event
    async def set_offline(sid, data):
        user_id = data.get("userId")
        if user_id:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": False, "lastSeen": datetime.now(timezone.utc)}}
            )
            await sio.broadcast.emit("user_status", {"userId": user_id, "isOnline": False})

    @sio.event
    async def join_group(sid, data):
        group_id = data.get("groupId")
        await sio.enter_room(sid, group_id)
        print(f"{sid} joined group {group_id}")

    @sio.event
    async def leave_group(sid, data):
        group_id = data.get("groupId")
        await sio.leave_room(sid, group_id)

    @sio.event
    async def send_message(sid, data):
        mode = data.get("deleteMode", "manual")
        duration = DELETE_DURATIONS.get(mode)
        expires_at = datetime.now(timezone.utc) + duration if duration else None

        msg = {
            "groupId":    ObjectId(data["groupId"]),
            "senderId":   ObjectId(data["senderId"]),
            "content":    data["content"],
            "readBy":     [ObjectId(data["senderId"])],
            "deleteMode": mode,
            "expiresAt":  expires_at,
            "createdAt":  datetime.now(timezone.utc)
        }
        result = await messages_col.insert_one(msg)

        payload = {
            "_id":        str(result.inserted_id),
            "groupId":    data["groupId"],
            "senderId":   data["senderId"],
            "content":    data["content"],
            "deleteMode": mode,
            "expiresAt":  expires_at.isoformat() if expires_at else None,
            "createdAt":  msg["createdAt"].isoformat()
        }
        await sio.emit("new_message", payload, room=data["groupId"])

    @sio.event
    async def delete_message(sid, data):
        await messages_col.delete_one({"_id": ObjectId(data["messageId"])})
        await sio.emit("message_deleted", {"messageId": data["messageId"]}, room=data["groupId"])

    @sio.event
    async def typing(sid, data):
        await sio.emit("user_typing", {
            "userId": data["userId"],
            "username": data["username"],
            "groupId": data["groupId"]
        }, room=data["groupId"], skip_sid=sid)