from datetime import datetime, timezone, timedelta
from bson import ObjectId
from bson.errors import InvalidId
from database import messages_col, users_col, groups_col
from jose import jwt, JWTError
import os
import socketio

DELETE_DURATIONS = {
    "manual": None,
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7)
}

connected_users = {}

def register_socket_events(sio):

    @sio.event
    async def connect(sid, environ, auth):
        if not auth or "token" not in auth:
            raise socketio.exceptions.ConnectionRefusedError("Authentication failed")
            
        token = auth.get("token")
        secret = os.getenv("JWT_SECRET")
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
            user_id = payload.get("sub")
            if not user_id:
                raise socketio.exceptions.ConnectionRefusedError("Invalid token")
            connected_users[sid] = user_id
            print(f"Client connected: {sid} (User: {user_id})")
            
            # Join personal room for private notifications
            await sio.enter_room(sid, user_id)
            
            # Join all current group and DM rooms for real-time messages
            async for g in groups_col.find({"members": ObjectId(user_id)}):
                await sio.enter_room(sid, str(g["_id"]))
        except JWTError:
            raise socketio.exceptions.ConnectionRefusedError("Invalid token")

    @sio.event
    async def disconnect(sid):
        user_id = connected_users.get(sid)
        if user_id:
            # Check if there are other active sessions for this user (multi-tab/refresh support)
            other_sessions = [s for s, uid in connected_users.items() if uid == user_id and s != sid]
            if not other_sessions:
                try:
                    await users_col.update_one(
                        {"_id": ObjectId(user_id)},
                        {"$set": {"isOnline": False, "lastSeen": datetime.now(timezone.utc)}}
                    )
                    await sio.emit("user_status", {"userId": user_id, "isOnline": False})
                except (InvalidId, TypeError):
                    pass
            # Always remove the disconnected session
            connected_users.pop(sid, None)
        print(f"Client disconnected: {sid}")

    @sio.event
    async def set_online(sid, data):
        user_id = connected_users.get(sid)
        if not user_id: return
        try:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": True, "lastSeen": datetime.now(timezone.utc)}}
            )
            await sio.emit("user_status", {"userId": user_id, "isOnline": True})
        except (InvalidId, TypeError):
            pass

    @sio.event
    async def set_offline(sid, data):
        user_id = connected_users.get(sid)
        if not user_id: return
        try:
            await users_col.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"isOnline": False, "lastSeen": datetime.now(timezone.utc)}}
            )
            await sio.emit("user_status", {"userId": user_id, "isOnline": False})
        except (InvalidId, TypeError):
            pass

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
        user_id = connected_users.get(sid)
        if not user_id: return
        
        group_id  = data.get("groupId")
        content   = data.get("content", "").strip()
        if not group_id or not content:
            return

        try:
            sender_oid = ObjectId(user_id)
            group_oid  = ObjectId(group_id)
        except (InvalidId, TypeError):
            return

        mode       = data.get("deleteMode", "manual")
        duration   = DELETE_DURATIONS.get(mode, None)
        expires_at = datetime.now(timezone.utc) + duration if duration else None

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
            "senderId":   user_id,
            "senderName": sender_name,
            "content":    content,
            "deleteMode": mode,
            "readBy":     [user_id],
            "expiresAt":  expires_at.isoformat() if expires_at else None,
            "createdAt":  msg["createdAt"].isoformat()
        }
        await sio.emit("new_message", payload, room=group_id)

    @sio.event
    async def mark_read(sid, data):
        user_id = connected_users.get(sid)
        if not user_id: return
        
        msg_id   = data.get("messageId")
        group_id = data.get("groupId")
        if not msg_id or not group_id: return
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
        user_id = connected_users.get(sid)
        if not user_id: return
        
        msg_id   = data.get("messageId")
        group_id = data.get("groupId")
        if not msg_id or not group_id: return
        
        try:
            msg_oid = ObjectId(msg_id)
            user_oid = ObjectId(user_id)
            
            # Verify the user is the sender
            msg = await messages_col.find_one({"_id": msg_oid})
            if not msg or msg.get("senderId") != user_oid:
                return
                
            # If the message has been read by anyone else, prevent deletion
            read_by = msg.get("readBy", [])
            if len(read_by) > 1 or (len(read_by) == 1 and read_by[0] != user_oid):
                return
                
            await messages_col.delete_one({"_id": msg_oid})
            
            # Find the new latest message in the group
            new_last_msg = await messages_col.find_one(
                {"groupId": ObjectId(group_id)},
                sort=[("createdAt", -1)]
            )
            
            new_last_payload = None
            if new_last_msg:
                new_last_payload = {
                    "content":    new_last_msg["content"],
                    "senderName": new_last_msg.get("senderName", ""),
                    "senderId":   str(new_last_msg["senderId"]),
                    "createdAt":  new_last_msg["createdAt"].isoformat()
                }
        except (InvalidId, TypeError):
            return
            
        await sio.emit("message_deleted", {
            "messageId": msg_id,
            "groupId": group_id,
            "newLastMessage": new_last_payload
        }, room=group_id)

    @sio.event
    async def typing(sid, data):
        user_id = connected_users.get(sid)
        if not user_id: return
        
        username = data.get("username")
        group_id = data.get("groupId")
        if username and group_id:
            await sio.emit("user_typing", {
                "userId":   user_id,
                "username": username,
                "groupId":  group_id
            }, room=group_id, skip_sid=sid)

    @sio.event
    async def notify_new_group(sid, data):
        group_id = data.get("groupId")
        members = data.get("members", [])
        if group_id:
            for m_id in members:
                m_str = str(m_id)
                # Instantly join all active socket connections (sids) of this user to the group room on backend
                member_sids = [s for s, uid in connected_users.items() if uid == m_str]
                for m_sid in member_sids:
                    await sio.enter_room(m_sid, group_id)
                # Emit group_added to their personal room so their UI loads the group
                await sio.emit("group_added", {"groupId": group_id}, room=m_str)