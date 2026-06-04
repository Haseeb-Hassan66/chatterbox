import motor.motor_asyncio
import os
from dotenv import load_dotenv

load_dotenv()

client = motor.motor_asyncio.AsyncIOMotorClient(os.getenv("MONGO_URI"), tz_aware=True)
db = client[os.getenv("DB_NAME")]

users_col    = db["users"]
messages_col = db["messages"]
groups_col   = db["groups"]