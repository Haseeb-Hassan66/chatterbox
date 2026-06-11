from fastapi import APIRouter, Depends
from database import messages_col, groups_col
from dependencies import get_current_user

router = APIRouter()

@router.get("/group-activity")
async def group_activity(current_user = Depends(get_current_user)):
    # Find all group IDs the user is a member of
    user_groups = await groups_col.find({"members": current_user["_id"]}).to_list(length=None)
    user_group_ids = [g["_id"] for g in user_groups]

    pipeline = [
        {"$match": {"groupId": {"$in": user_group_ids}}},
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