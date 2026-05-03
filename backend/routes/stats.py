from fastapi import APIRouter
from database import messages_col

router = APIRouter()

@router.get("/group-activity")
async def group_activity():
    pipeline = [
        {"$group": {
            "_id": "$groupId",
            "messageCount": {"$sum": 1},
            "lastMessage": {"$max": "$createdAt"}
        }},
        {"$sort": {"messageCount": -1}},
        {"$limit": 10},
        {"$lookup": {
            "from": "groups",
            "localField": "_id",
            "foreignField": "_id",
            "as": "group"
        }},
        {"$unwind": "$group"},
        {"$project": {
            "groupName": "$group.name",
            "messageCount": 1,
            "lastMessage": 1
        }}
    ]
    results = []
    async for doc in messages_col.aggregate(pipeline):
        doc["_id"] = str(doc["_id"])
        doc["lastMessage"] = doc["lastMessage"].isoformat() if doc.get("lastMessage") else None
        results.append(doc)
    return results