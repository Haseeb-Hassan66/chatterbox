from datetime import datetime, timezone, timedelta
from bson import ObjectId
from bson.errors import InvalidId
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
        if not user_id:
            return
        try:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": True, "lastSeen": datetime.now(timezone.utc)}}
            )
        except (InvalidId, TypeError):
            return
        await sio.emit("user_status", {"userId": user_id, "isOnline": True})

    @sio.event
    async def set_offline(sid, data):
        user_id = data.get("userId")
        if not user_id:
            return
        try:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": False, "lastSeen": datetime.now(timezone.utc)}}
            )
        except (InvalidId, TypeError):
            return
        await sio.emit("user_status", {"userId": user_id, "isOnline": False})

    @sio.event
    async def join_group(sid, data):
        group_id = data.get("groupId")
        if group_id:
            await sio.enter_room(sid, group_id)

    @sio.event
    async def leave_group(sid, data):
        group_id = data.get("groupId")
        if group_id:
            await sio.leave_room(sid, group_id)

    @sio.event
    async def send_message(sid, data):
        sender_id = data.get("senderId")
        group_id  = data.get("groupId")
        content   = data.get("content", "").strip()
        if not sender_id or not group_id or not content:
            return  # Silently drop incomplete messages

        try:
            sender_oid = ObjectId(sender_id)
            group_oid  = ObjectId(group_id)
        except (InvalidId, TypeError):
            return  # Drop malformed IDs silently

        mode       = data.get("deleteMode", "manual")
        duration   = DELETE_DURATIONS.get(mode, None)
        expires_at = datetime.now(timezone.utc) + duration if duration else None

        # Fetch sender username so it's stored in the message
        sender      = await users_col.find_one({"_id": sender_oid})
        sender_name = sender["username"] if sender else "Unknown"

        msg = {
            "groupId":    group_oid,
            "senderId":   sender_oid,
            "senderName": sender_name,
            "content":    content,
            "readBy":     [sender_oid],
            "deleteMode": mode,
            "expiresAt":  expires_at,
            "createdAt":  datetime.now(timezone.utc)
        }
        result = await messages_col.insert_one(msg)

        payload = {
            "_id":        str(result.inserted_id),
            "groupId":    group_id,
            "senderId":   sender_id,
            "senderName": sender_name,
            "content":    content,
            "deleteMode": mode,
            "readBy":     [sender_id],
            "expiresAt":  expires_at.isoformat() if expires_at else None,
            "createdAt":  msg["createdAt"].isoformat()
        }
        await sio.emit("new_message", payload, room=group_id)

    @sio.event
    async def mark_read(sid, data):
        msg_id   = data.get("messageId")
        user_id  = data.get("userId")
        group_id = data.get("groupId")
        if not (msg_id and user_id and group_id):
            return
        try:
            await messages_col.update_one(
                {"_id": ObjectId(msg_id)},
                {"$addToSet": {"readBy": ObjectId(user_id)}}
            )
        except (InvalidId, TypeError):
            return
        await sio.emit("message_read", {
            "messageId": msg_id,
            "userId":    user_id
        }, room=group_id)

    @sio.event
    async def delete_message(sid, data):
        msg_id   = data.get("messageId")
        group_id = data.get("groupId")
        if not msg_id or not group_id:
            return
        try:
            await messages_col.delete_one({"_id": ObjectId(msg_id)})
        except (InvalidId, TypeError):
            return
        await sio.emit("message_deleted", {
            "messageId": msg_id
        }, room=group_id)

    @sio.event
    async def typing(sid, data):
        user_id  = data.get("userId")
        username = data.get("username")
        group_id = data.get("groupId")
        if user_id and username and group_id:
            await sio.emit("user_typing", {
                "userId":   user_id,
                "username": username,
                "groupId":  group_id
            }, room=group_id, skip_sid=sid)